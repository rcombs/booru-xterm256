#! /usr/bin/env node

var parseString = require('xml2js').parseString,
    request = require('request').defaults({headers: {'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/600.5.9 (KHTML, like Gecko) Version/8.0.5 Safari/600.5.9'}}),
    child_process = require('child_process'),
    open = require('openurl').open,
    url = require('url'),
    ProgressBar = require('progress');

var argv = require('yargs').argv;

var apis = {
  gelbooru: 'http://gelbooru.com/index.php?page=dapi&s=post&q=index&pid=PAGE',
  danbooru: 'http://danbooru.donmai.us/post/index.xml?page=PAGE',
  sankakuchan: 'https://chan.sankakucomplex.com/post/index.xml?page=PAGE',
  idol: 'https://idol.sankakucomplex.com/post/index.xml?page=PAGE',
  behoimi: 'http://behoimi.org/post/index.xml?page=PAGE'
}

var api = argv.api || apis[argv.site] || apis.gelbooru;

var tags = argv.tags;

var list = [];
var index = 0;
var count = Infinity;
var pageSize = argv.pageSize ? parseInt(argv.pageSize, 10) : 50;

var img2args = argv.img2args ? argv.img2args.split(' ') : ['-yw', '2'];

function reset() {
  process.stdout.write('\033[0f');
}

function clear() {
  process.stdout.write('\033[2J');
}

var displaying = false;
var magick, img2, imgReq;

function killChildren() {
  if (displaying) {
    img2.kill('SIGKILL');
    magick.kill('SIGKILL');
    imgReq.abort();
    return true;
  }
}

function displayImage(item) {
  if (killChildren()) {
    magick.on('exit', function () {
      displayImage(item);
    });
    return false;
  }

  displaying = true;

  var w = process.stdout.columns - 1;
  var h = (process.stdout.rows - 1) * 2;

  var optimal;
  for (var i = 0; i < item.images.length; i++) {
    optimal = item.images[i];
    if (optimal.width >= w || optimal.height >= h)
      break;
  }
  imgReq = request(optimal.uri);
  var size = w + 'x' + h;
  magick = child_process.spawn('convert', [
    '-',
    '-thumbnail', size,
    '-background', 'white',
    '-compose', 'Copy',
    '-gravity', 'center',
    '-extent', size,
    '-quality', '100',
    '-format', 'bmp',
    '-'
  ], {stdio: ['pipe', 'pipe', 'ignore']});
  img2 = child_process.spawn('img2xterm', img2args, {
    stdio: ['pipe', 'pipe', 'ignore']
  });
  imgReq.on('error', function(err) {
    console.error(err);
  });
  imgReq.on('response', function(res) {
    var bar;
    if (res.headers['content-length'])
      bar = new ProgressBar(':bar', {
        total: parseInt(res.headers['content-length'], 10),
        width: process.stdout.columns - 2
      });
    function gotChunk(chunk) {
      if (bar)
        bar.tick(chunk.length);
      magick.stdin.write(chunk);
    }
    imgReq.on('data', gotChunk);
    function gotEnd() {
      reset();
      magick.stdin.end();
    }
    imgReq.on('end', gotEnd);
    magick.on('exit', function() {
      imgReq.removeListener('data', gotChunk);
      imgReq.removeListener('end', gotEnd);
      img2.stdin.end();
    });
  });
  magick.stdout.pipe(img2.stdin);
  img2.stdout.on('data', function (chunk) {
    process.stdout.write(chunk);
  });
  img2.on('exit', function (code) {
    magick.stdout.unpipe(img2.stdin);
    displaying = false;
  });
  imgReq.on('error', function(){/*gulp*/});
  magick.stdin.on('error', function(){/*gulp*/});
  magick.stdout.on('error', function(){/*gulp*/});
  img2.stdin.on('error', function(){/*gulp*/});
}

function displayCurrent(offset) {
  if (!offset)
    offset = 0;


  index += offset;
  if (index < 0)
    index = 0;

  if (index >= count)
    index = count - 1;

  if (index >= list.length) {
    return requestList();
  }

  displayImage(list[index]);
}

function handleUrl(uri) {
  return url.resolve(api, uri);
}

function parsePost(post) {
  var ret = {
    images: [],
    source: handleUrl(post.file_url)
  };
  if (post.preview_url)
    ret.images.push({
      width: parseInt(post.preview_width, 10),
      height: parseInt(post.preview_height, 10),
      uri: handleUrl(post.preview_url)
    });
  if (post.sample_url)
    ret.images.push({
      width: parseInt(post.sample_width, 10),
      height: parseInt(post.sample_height, 10),
      uri: handleUrl(post.sample_url)
    });
  ret.images.push({
    width: parseInt(post.width, 10),
    height: parseInt(post.height, 10),
    uri: handleUrl(post.file_url)
  });
  return ret;
}

function requestList() {
  var url = api + '&limit=' + pageSize;
  var page = ((index / pageSize) | 0);
  url = url.replace('PAGE', page);
  if (tags)
    url += '&tags=' + tags;
  var offset = page * pageSize;
  request(url, function (err, res, body) {
    if (!body) {
      console.error(err, res);
      return;
    }
    parseString(body, function (err, result) {
      if (!result || !result.posts || !result.posts.post || !result.posts.post.length) {
        console.error(result, err);
        return;
      }
      count = result.posts.$.count;
      for (var i = 0; i < result.posts.post.length; i++) {
        list[offset + i] = parsePost(result.posts.post[i].$);
      }
      displayCurrent();
    });
  });
}

var keypress = require('keypress');

// make `process.stdin` begin emitting 'keypress' events
keypress(process.stdin);

// listen for the 'keypress' event
process.stdin.on('keypress', function (ch, key) {
  if (!key)
    return;

  if (key.ctrl && key.name == 'c') {
    process.exit(0);
  } else if (key.name == 'right') {
    displayCurrent(1);
  } else if (key.name == 'left') {
    displayCurrent(-1);
  } else if (key.name == 'up') {
    displayCurrent(10);
  } else if (key.name == 'down') {
    displayCurrent(-10);
  } else if (key.name == 'return') {
    if (list[index])
      open(list[index].source);
  } else if (key.name == 'q') {
    process.exit(0);
  }
});

process.stdout.on('resize', function (){
  displayCurrent();
})

process.stdin.setRawMode(true);
process.stdin.resume();

clear();

requestList();

process.on('beforeExit', killChildren);
