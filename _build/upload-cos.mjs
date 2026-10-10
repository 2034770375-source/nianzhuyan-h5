// 年猪宴 · 发布到腾讯云 COS（+ 可选刷新 CDN）
//
// 为什么自己写而不用 SDK：这台机器上没有 npm，装不了 cos-nodejs-sdk-v5 / coscmd，
// 而 COS 的上传不过是"按规范算一个签名，然后 PUT"。所以把签名算法照规范实现一份，
// 只用 Node 内置的 crypto 和 fetch。
//
// 凭据从哪来（两者取其一，环境变量优先）：
//   1) 环境变量 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY
//   2) 工程根目录的 .cos.json（已在 .gitignore 里，不会被提交）：
//      {
//        "secretId": "...",
//        "secretKey": "...",
//        "bucket": "nianzhuyan-1250000000",   // 存储桶全名，含 APPID 后缀
//        "region": "ap-shanghai",
//        "cdnHost": "nianzhuyan.com",         // 可选：填了才能用 --purge
//        "purge": false
//      }
//
// 用法：
//   node _build/upload-cos.mjs --check          # 只验证凭据与桶是否可用，不传任何东西
//   node _build/upload-cos.mjs                  # 上传 dist/ 全量
//   node _build/upload-cos.mjs --purge          # 传完再刷新 CDN 上的 index.html
//   node _build/upload-cos.mjs --selftest       # 离线自检：核对 TC3 签名算得对不对
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H5_ROOT = path.resolve(HERE, '..');
const DIST = path.join(H5_ROOT, 'dist');

const has = (flag) => process.argv.includes(flag);
const argOf = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};

/* ------------------------------ 密码学小工具 ------------------------------ */

const sha1hex = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (algo, key, data) => crypto.createHmac(algo, key).update(data, 'utf8').digest();
const hmacHex = (algo, key, data) => crypto.createHmac(algo, key).update(data, 'utf8').digest('hex');

/* ------------------------------ 腾讯云 TC3 签名 ------------------------------ */

// 给"腾讯云 API"（刷新 CDN 那类管理接口）用的 TC3-HMAC-SHA256 签名。
// 这段是唯一没法在本机跑真实请求的部分，所以配了官方文档里的测试向量做自检（见 --selftest）。
function tc3Sign({ secretId, secretKey, service, host, action, payload, region, timestamp }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  /* 官方 SDK 与 API 网关认的都是 application/json，不带 charset——多带一段会让
     CanonicalHeaders 和实际发出的请求头不一致，签名就对不上了 */
  const contentType = 'application/json';

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const hashedPayload = sha256hex(payload);
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');

  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac('sha256', 'TC3' + secretKey, date);
  const kService = hmac('sha256', kDate, service);
  const kSigning = hmac('sha256', kService, 'tc3_request');
  const signature = hmacHex('sha256', kSigning, stringToSign);

  return {
    signature,
    authorization:
      `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    headers: {
      'Content-Type': contentType,
      Host: host,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': '2018-06-06',
      ...(region ? { 'X-TC-Region': region } : {})
    }
  };
}

/* ------------------------------ COS 请求签名（v5 / sha1） ------------------------------ */

// COS 的 URL 编码：比 encodeURIComponent 多转义五个字符，与官方 SDK 的 camSafeUrlEncode 一致
const camSafeUrlEncode = (s) =>
  encodeURIComponent(String(s))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');

/*
 * 请求签名（COS v5 / sha1）。比对过官方 cos-nodejs-sdk-v5 的 getAuthorization：
 *   SignKey  = HMAC-SHA1(SecretKey, KeyTime)
 *   HttpString = 方法 + \n + 路径 + \n + query + \n + headers + \n
 *     —— headers 段是 "k=v&k=v"（用 & 连接、键小写升序），**段内不再有换行**；
 *        这一点最容易写错：写成每行一个 header，签名值就整个不对。
 *   StringToSign = "sha1\n" + KeyTime + "\n" + sha1(HttpString) + "\n"
 *
 * 发送哪些头就签哪些头：多签一个没发的头、或者发了却标在签名里却没有，都会被服务端拒掉。
 */
function cosAuthorization({ secretId, secretKey, method, key, headers, timestamp }) {
  const signTime = `${timestamp};${timestamp + 900}`;
  const signKey = hmacHex('sha1', secretKey, signTime);

  // 对象键逐段编码，斜杠保留
  const uriPath = '/' + key.split('/').map(camSafeUrlEncode).join('/');

  const names = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const headerList = names.join(';');
  const headerStr = names
    .map((k) => `${camSafeUrlEncode(k).toLowerCase()}=${camSafeUrlEncode(headers[k])}`)
    .join('&');

  const httpString = [method.toLowerCase(), uriPath, '', headerStr, ''].join('\n');
  const stringToSign = ['sha1', signTime, sha1hex(httpString), ''].join('\n');
  const signature = hmacHex('sha1', signKey, stringToSign);

  return {
    uriPath,
    headerList,
    httpString,
    authorization:
      'q-sign-algorithm=sha1' +
      `&q-ak=${secretId}` +
      `&q-sign-time=${signTime}` +
      `&q-key-time=${signTime}` +
      `&q-header-list=${headerList}` +
      '&q-url-param-list=' +
      `&q-signature=${signature}`
  };
}

/* ------------------------------ 自检 ------------------------------ */

function selftest() {
  // 向量取自腾讯云官方 Node SDK 的测试文件 test/common/sign.test.ts（sign3 第一条）：
  // 参数与期望签名都照抄，只要签名对得上，算法就没错。
  const expect = '96473b50fe407833672a5d6d067238d88bb44c8abcc39ef83baa3132afbfadd3';
  const got = tc3Sign({
    secretId: 'test-secret-id',
    secretKey: 'test-secret-key',
    service: 'cvm',
    host: 'cvm.tencentcloudapi.com',
    action: 'DescribeInstances',
    region: null,
    payload: '{"Action":"DescribeInstances","Version":"2017-03-12"}',
    timestamp: 1640995200
  }).signature;

  const ok = got === expect;
  console.log(`${ok ? '✓' : '✗'} TC3 签名自检`);
  console.log(`  期望 ${expect}`);
  console.log(`  实得 ${got}`);

  // COS 没有公布可直接对照的签名向量，所以改钉住"待签名串"的格式——
  // 这段格式是照着官方 SDK 的 obj2str / getAuthorization 抄的，钉住它等于钉住最容易写错的地方。
  const a = cosAuthorization({
    secretId: 'AKIDtest', secretKey: 'secrettest', method: 'PUT',
    key: 'app/pages/map/assets/map_pig.png',
    headers: {
      host: 'b-1250000000.cos.ap-shanghai.myqcloud.com',
      'content-type': 'image/png',
      'cache-control': 'public, max-age=2592000'
    },
    timestamp: 1700000000
  });

  const wantHttp =
    'put\n/app/pages/map/assets/map_pig.png\n\n' +
    'cache-control=public%2C%20max-age%3D2592000&content-type=image%2Fpng&host=b-1250000000.cos.ap-shanghai.myqcloud.com\n';
  const shapeOk =
    a.httpString === wantHttp &&
    a.headerList === 'cache-control;content-type;host' &&
    /^q-sign-algorithm=sha1&q-ak=.+&q-signature=[0-9a-f]{40}$/.test(a.authorization);

  console.log(`${shapeOk ? '✓' : '✗'} COS 待签名串格式`);
  console.log(`  路径 ${a.uriPath}`);
  console.log(`  头列表 ${a.headerList}`);
  if (!shapeOk) {
    console.log('  期望 ' + JSON.stringify(wantHttp));
    console.log('  实得 ' + JSON.stringify(a.httpString));
  }

  if (!ok || !shapeOk) process.exitCode = 1;
}

/* ------------------------------ 配置 ------------------------------ */

function loadConfig() {
  const file = path.join(H5_ROOT, '.cos.json');
  let cfg = {};
  if (fs.existsSync(file)) {
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.error('✗ .cos.json 不是合法 JSON：' + e.message);
      process.exit(1);
    }
  }
  const merged = {
    secretId: process.env.TENCENTCLOUD_SECRET_ID || cfg.secretId,
    secretKey: process.env.TENCENTCLOUD_SECRET_KEY || cfg.secretKey,
    bucket: process.env.COS_BUCKET || cfg.bucket,
    region: process.env.COS_REGION || cfg.region,
    cdnHost: cfg.cdnHost || null,
    purge: cfg.purge === true
  };
  const missing = ['secretId', 'secretKey', 'bucket', 'region'].filter((k) => !merged[k]);
  if (missing.length) {
    console.error('✗ 缺少配置：' + missing.join('、'));
    console.error('  在工程根目录建 .cos.json（已被 .gitignore 挡住），或设环境变量：');
    console.error('    TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY / COS_BUCKET / COS_REGION');
    process.exit(1);
  }
  return merged;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon'
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

/* ------------------------------ 主流程 ------------------------------ */

if (has('--selftest')) {
  selftest();
} else {
  const cfg = loadConfig();
  const host = `${cfg.bucket}.cos.${cfg.region}.myqcloud.com`;

  if (has('--check')) {
    const ts = Math.floor(Date.now() / 1000);
    const sign = cosAuthorization({ ...cfg, method: 'GET', key: '', headers: { host }, timestamp: ts });
    const res = await fetch(`https://${host}/?list-type=2&max-keys=1`, {
      headers: { Authorization: sign.authorization, Host: host }
    });
    const text = await res.text();
    console.log(res.ok ? '✓ 凭据可用，桶可访问' : `✗ 桶访问失败：HTTP ${res.status}`);
    if (!res.ok) {
      console.log('  ' + text.slice(0, 300));
      process.exitCode = 1;
    } else {
      console.log(`  桶 ${cfg.bucket}（${cfg.region}）列表请求成功`);
    }
  } else {
    if (!fs.existsSync(DIST)) {
      console.error('✗ 找不到 dist/，先跑 node _build/dist.mjs');
      process.exit(1);
    }

    const files = walk(DIST);
    let ok = 0;
    const bad = [];

    for (const file of files) {
      const key = path.relative(DIST, file).split(path.sep).join('/');
      const body = fs.readFileSync(file);
      const ts = Math.floor(Date.now() / 1000);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      // 首页不缓存（改完立刻生效）；bundle.js 文件名不变但内容会变，给它短缓存；
      // 其余素材（图片/字体）内容随文件名走，长缓存
      const cache = key === 'index.html' ? 'no-cache'
        : key === 'app/bundle.js' ? 'public, max-age=600'
          : 'public, max-age=2592000';

      /* 发什么就签什么：这三个头一起进签名，实际请求也原样带上 */
      const headers = { host, 'content-type': type, 'cache-control': cache };
      const sign = cosAuthorization({ ...cfg, method: 'PUT', key, headers, timestamp: ts });

      const res = await fetch(`https://${host}${sign.uriPath}`, {
        method: 'PUT',
        headers: { ...headers, Authorization: sign.authorization },
        body
      });

      if (res.ok) ok += 1;
      else bad.push(`${key} → HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    }

    console.log(`上传完成：${ok} / ${files.length} 个文件`);
    if (bad.length) {
      console.error('以下文件失败：');
      bad.slice(0, 10).forEach((b) => console.error('  ✗ ' + b));
      process.exitCode = 1;
    } else {
      console.log(`站点地址：https://${cfg.cdnHost || host}/`);
    }

    if ((has('--purge') || cfg.purge) && cfg.cdnHost) {
      const ts = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({ Urls: [`https://${cfg.cdnHost}/`, `https://${cfg.cdnHost}/index.html`] });
      const sign = tc3Sign({
        ...cfg,
        service: 'cdn',
        host: 'cdn.tencentcloudapi.com',
        action: 'PurgePathCache',
        payload,
        timestamp: ts
      });
      const res = await fetch('https://cdn.tencentcloudapi.com/', {
        method: 'POST',
        headers: { ...sign.headers, Authorization: sign.authorization },
        body: payload
      });
      const json = await res.json().catch(() => null);
      const r = json && json.Response;
      if (res.ok && r && !r.Error) console.log('✓ 已提交 CDN 刷新（index.html）');
      else console.error('✗ CDN 刷新失败：' + JSON.stringify((r && r.Error) || json).slice(0, 300));
    }
  }
}
