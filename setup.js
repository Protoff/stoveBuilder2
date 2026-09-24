'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');

var ROOT = __dirname;
var LIB_DIR = path.join(ROOT, 'js', 'libs');
var APP_DIR = path.join(ROOT, 'js', 'app');
var CSS_DIR = path.join(ROOT, 'css', 'app');

var FILES = [
  { file: 'three.min.js',     url: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js' },
  { file: 'OrbitControls.js', url: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js' },
  { file: 'js-yaml.min.js',   url: 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js' },
  { file: 'jspdf.umd.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' }
];

function allPresent() {
  for (var i = 0; i < FILES.length; i++) {
    if (!fs.existsSync(path.join(LIB_DIR, FILES[i].file))) return false;
  }
  return true;
}

function download(url, dest, done) {
  var mod = url.indexOf('https://') === 0 ? https : http;
  var req = mod.get(url, function (res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      download(res.headers.location, dest, done);
      return;
    }
    if (res.statusCode !== 200) {
      res.resume();
      done(new Error('HTTP ' + res.statusCode + ' для ' + url));
      return;
    }
    var out = fs.createWriteStream(dest);
    res.pipe(out);
    out.on('finish', function () {
      out.close(function () { done(null); });
    });
    out.on('error', function (err) {
      out.close();
      done(err);
    });
  });
  req.on('error', done);
  req.setTimeout(60000, function () {
    req.destroy(new Error('Таймаут при скачивании ' + url));
  });
}

function run() {
  if (allPresent()) {
    console.log('Все библиотеки на месте, автономный режим готов');
    process.exit(0);
    return;
  }

  [LIB_DIR, APP_DIR, CSS_DIR].forEach(function (dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  var left = 0;
  var failed = 0;

  FILES.forEach(function (item) {
    var dest = path.join(LIB_DIR, item.file);
    if (fs.existsSync(dest)) return;
    left++;
    download(item.url, dest, function (err) {
      if (err) {
        failed++;
        console.error('Ошибка: ' + item.file + ' не скачан (' + err.message + ')');
      } else {
        console.log('Скачано: ' + item.file);
      }
      left--;
      if (left === 0) {
        if (failed > 0) {
          console.error('Не удалось скачать ' + failed + ' файл(ов). Проверьте интернет и повторите: node setup.js');
          process.exit(1);
        } else {
          console.log('Все библиотеки на месте, автономный режим готов');
          process.exit(0);
        }
      }
    });
  });
}

run();