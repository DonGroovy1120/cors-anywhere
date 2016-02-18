require('./setup');

var createServer = require('../').createServer;
var request = require('supertest');
var path = require('path');
var http = require('http');
var fs = require('fs');
var assert = require('assert');

var helpTextPath = path.join(__dirname, '../lib/help.txt');
var helpText = fs.readFileSync(helpTextPath, { encoding: 'utf8' });

request.Test.prototype.expectJSON = function(json, done) {
  this.expect(function(res) {
    // Assume that the response can be parsed as JSON (otherwise it throws).
    var actual = JSON.parse(res.text);
    assert.deepEqual(actual, json);
  });
  return done ? this.end(done) : this;
};

request.Test.prototype.expectNoHeader = function(header, done) {
  this.expect(function(res) {
    if (header.toLowerCase() in res.headers) {
      return 'Unexpected header in response: ' + header;
    }
  });
  return done ? this.end(done) : this;
};

var cors_anywhere;
var cors_anywhere_port;
function stopServer(done) {
  cors_anywhere.close(function() {
    done();
  });
  cors_anywhere = null;
}

describe('Basic functionality', function() {
  before(function() {
    cors_anywhere = createServer();
    cors_anywhere_port = cors_anywhere.listen(0).address().port;
  });
  after(stopServer);

  it('GET /', function(done) {
    request(cors_anywhere)
      .get('/')
      .type('text/plain')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, helpText, done);
  });

  it('GET /iscorsneeded', function(done) {
    request(cors_anywhere)
      .get('/iscorsneeded')
      .expectNoHeader('access-control-allow-origin', done);
  });

  it('GET /example.com:65536', function(done) {
    request(cors_anywhere)
      .get('/example.com:65536')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(400, 'Port number too large: 65536', done);
  });

  it('GET /favicon.ico', function(done) {
    request(cors_anywhere)
      .get('/favicon.ico')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(404, 'Invalid host: favicon.ico', done);
  });

  it('GET /robots.txt', function(done) {
    request(cors_anywhere)
      .get('/robots.txt')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(404, 'Invalid host: robots.txt', done);
  });

  it('GET /http://robots.txt should be proxied', function(done) {
    request(cors_anywhere)
      .get('/http://robots.txt')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, 'this is http://robots.txt', done);
  });

  it('GET /example.com', function(done) {
    request(cors_anywhere)
      .get('/example.com')
      .expect('Access-Control-Allow-Origin', '*')
      .expect('x-request-url', 'http://example.com/')
      .expect(200, 'Response from example.com', done);
  });

  it('GET //example.com', function(done) {
    // '/example.com' is an invalid URL.
    request(cors_anywhere)
      .get('//example.com')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, helpText, done);
  });

  it('GET ///example.com', function(done) {
    // API base URL (with trailing slash) + '//example.com'
    request(cors_anywhere)
      .get('///example.com')
      .expect('Access-Control-Allow-Origin', '*')
      .expect('x-request-url', 'http://example.com/')
      .expect(200, 'Response from example.com', done);
  });

  it('GET /http://example.com', function(done) {
    request(cors_anywhere)
      .get('/http://example.com')
      .expect('Access-Control-Allow-Origin', '*')
      .expect('x-request-url', 'http://example.com/')
      .expect(200, 'Response from example.com', done);
  });

  it('POST plain text', function(done) {
    request(cors_anywhere)
      .post('/example.com/echopost')
      .send('{"this is a request body & should not be mangled":1.00}')
      .expect('Access-Control-Allow-Origin', '*')
      .expect('{"this is a request body & should not be mangled":1.00}', done);
  });

  it('POST file', function(done) {
    request(cors_anywhere)
      .post('/example.com/echopost')
      .attach('file', path.join(__dirname, 'dummy.txt'))
      .expect('Access-Control-Allow-Origin', '*')
      .expect(/\r\nContent-Disposition: form-data; name="file"; filename="dummy.txt"\r\nContent-Type: text\/plain\r\n\r\ndummy content\n\r\n/, done);
  });

  it('HEAD with redirect should be followed', function(done) {
    // Redirects are automatically followed, because redirects are to be
    // followed automatically per specification regardless of the HTTP verb.
    request(cors_anywhere)
      .head('/example.com/redirect')
      .redirects(0)
      .expect('Access-Control-Allow-Origin', '*')
      .expect('some-header', 'value')
      .expect('x-request-url', 'http://example.com/redirect')
      .expect('x-cors-redirect-1', '302 http://example.com/redirecttarget')
      .expect('x-final-url', 'http://example.com/redirecttarget')
      .expect('access-control-expose-headers', /some-header,x-final-url/)
      .expectNoHeader('header at redirect')
      .expect(200, '', done);
  });

  it('GET with redirect should be followed', function(done) {
    request(cors_anywhere)
      .get('/example.com/redirect')
      .redirects(0)
      .expect('Access-Control-Allow-Origin', '*')
      .expect('some-header', 'value')
      .expect('x-request-url', 'http://example.com/redirect')
      .expect('x-cors-redirect-1', '302 http://example.com/redirecttarget')
      .expect('x-final-url', 'http://example.com/redirecttarget')
      .expect('access-control-expose-headers', /some-header,x-final-url/)
      .expectNoHeader('header at redirect')
      .expect(200, 'redirect target', done);
  });

  it('GET with redirect loop should interrupt', function(done) {
    request(cors_anywhere)
      .get('/example.com/redirectloop')
      .redirects(0)
      .expect('Access-Control-Allow-Origin', '*')
      .expect('x-request-url', 'http://example.com/redirectloop')
      .expect('x-cors-redirect-1', '302 http://example.com/redirectloop')
      .expect('x-cors-redirect-2', '302 http://example.com/redirectloop')
      .expect('x-cors-redirect-3', '302 http://example.com/redirectloop')
      .expect('x-cors-redirect-4', '302 http://example.com/redirectloop')
      .expect('x-cors-redirect-5', '302 http://example.com/redirectloop')
      .expect('Location', /^http:\/\/127.0.0.1:\d+\/http:\/\/example.com\/redirectloop$/)
      .expect(302, 'redirecting ad infinitum...', done);
  });

  it('POST with 302 redirect should be followed', function(done) {
    request(cors_anywhere)
      .post('/example.com/redirectpost')
      .redirects(0)
      .expect('Access-Control-Allow-Origin', '*')
      .expect('x-request-url', 'http://example.com/redirectpost')
      .expect('x-cors-redirect-1', '302 http://example.com/redirectposttarget')
      .expect('x-final-url', 'http://example.com/redirectposttarget')
      .expect('access-control-expose-headers', /x-final-url/)
      .expect(200, 'post target', done);
  });

  it('POST with 307 redirect should not be handled', function(done) {
    // Because of implementation difficulties (having to keep the request body
    // in memory), handling HTTP 307/308 redirects is deferred to the requestor.
    request(cors_anywhere)
      .post('/example.com/redirect307')
      .redirects(0)
      .expect('Access-Control-Allow-Origin', '*')
      .expect('x-request-url', 'http://example.com/redirect307')
      .expect('Location', /^http:\/\/127.0.0.1:\d+\/http:\/\/example.com\/redirectposttarget$/)
      .expect('x-final-url', 'http://example.com/redirect307')
      .expect('access-control-expose-headers', /x-final-url/)
      .expect(307, 'redirecting...', done);
  });

  it('OPTIONS /', function(done) {
    request(cors_anywhere)
      .options('/')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, '', done);
  });

  it('OPTIONS / with Access-Control-Request-Method / -Headers', function(done) {
    request(cors_anywhere)
      .options('/')
      .set('Access-Control-Request-Method', 'DELETE')
      .set('Access-Control-Request-Headers', 'X-Tralala')
      .expect('Access-Control-Allow-Origin', '*')
      .expect('Access-Control-Allow-Methods', 'DELETE')
      .expect('Access-Control-Allow-Headers', 'X-Tralala')
      .expect(200, '', done);
  });

  it('OPTIONS //bogus', function(done) {
    // The preflight request always succeeds, regardless of whether the request
    // is valid.
    request(cors_anywhere)
      .options('//bogus')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, '', done);
  });

  it('X-Forwarded-* headers', function(done) {
    request(cors_anywhere)
      .get('/example.com/echoheaders')
      .set('test-include-xfwd', '')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com',
        'x-forwarded-port': String(cors_anywhere_port),
        'x-forwarded-proto': 'http',
      }, done);
  });

  it('X-Forwarded-* headers (non-standard port)', function(done) {
    request(cors_anywhere)
      .get('/example.com:1337/echoheaders')
      .set('test-include-xfwd', '')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com:1337',
        'x-forwarded-port': String(cors_anywhere_port),
        'x-forwarded-proto': 'http',
      }, done);
  });

  it('X-Forwarded-* headers (https)', function(done) {
    request(cors_anywhere)
      .get('/https://example.com/echoheaders')
      .set('test-include-xfwd', '')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com',
        'x-forwarded-port': String(cors_anywhere_port),
        'x-forwarded-proto': 'http',
      }, done);
  });

  it('Ignore cookies', function(done) {
    request(cors_anywhere)
      .get('/example.com/setcookie')
      .expect('Access-Control-Allow-Origin', '*')
      .expect('Set-Cookie3', 'z')
      .expectNoHeader('set-cookie')
      .expectNoHeader('set-cookie2', done);
  });

  it('Proxy error', function(done) {
    request(cors_anywhere)
      .get('/example.com/proxyerror')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(404, 'Not found because of proxy error: Error: throw node', done);
  });
});

describe('server on https', function() {
  var NODE_TLS_REJECT_UNAUTHORIZED;
  before(function() {
    cors_anywhere = createServer({
      httpsOptions: {
        key: fs.readFileSync(path.join(__dirname, 'key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
      },
    });
    cors_anywhere_port = cors_anywhere.listen(0).address().port;
    // Disable certificate validation in case the certificate expires.
    NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  });
  after(function(done) {
    if (NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = NODE_TLS_REJECT_UNAUTHORIZED;
    }
    stopServer(done);
  });

  it('X-Forwarded-* headers (http)', function(done) {
    request(cors_anywhere)
      .get('/example.com/echoheaders')
      .set('test-include-xfwd', '')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com',
        'x-forwarded-port': String(cors_anywhere_port),
        'x-forwarded-proto': 'https',
      }, done);
  });

  it('X-Forwarded-* headers (https)', function(done) {
    request(cors_anywhere)
      .get('/https://example.com/echoheaders')
      .set('test-include-xfwd', '')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com',
        'x-forwarded-port': String(cors_anywhere_port),
        'x-forwarded-proto': 'https',
      }, done);
  });

  it('X-Forwarded-* headers (https, non-standard port)', function(done) {
    request(cors_anywhere)
      .get('/https://example.com:1337/echoheaders')
      .set('test-include-xfwd', '')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com:1337',
        'x-forwarded-port': String(cors_anywhere_port),
        'x-forwarded-proto': 'https',
      }, done);
  });
});

describe('originBlacklist', function() {
  before(function() {
    cors_anywhere = createServer({
      originBlacklist: ['http://denied.origin.test'],
    });
    cors_anywhere_port = cors_anywhere.listen(0).address().port;
  });
  after(stopServer);

  it('GET /example.com with denied origin', function(done) {
    request(cors_anywhere)
      .get('/example.com/')
      .set('Origin', 'http://denied.origin.test')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(403, done);
  });

  it('GET /example.com without denied origin', function(done) {
    request(cors_anywhere)
      .get('/example.com/')
      .set('Origin', 'https://denied.origin.test') // Note: different scheme!
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, done);
  });

  it('GET /example.com without origin', function(done) {
    request(cors_anywhere)
      .get('/example.com/')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, done);
  });
});

describe('originWhitelist', function() {
  before(function() {
    cors_anywhere = createServer({
      originWhitelist: ['https://permitted.origin.test'],
    });
    cors_anywhere_port = cors_anywhere.listen(0).address().port;
  });
  after(stopServer);

  it('GET /example.com with permitted origin', function(done) {
    request(cors_anywhere)
      .get('/example.com/')
      .set('Origin', 'https://permitted.origin.test')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, done);
  });

  it('GET /example.com without permitted origin', function(done) {
    request(cors_anywhere)
      .get('/example.com/')
      .set('Origin', 'http://permitted.origin.test') // Note: different scheme!
      .expect('Access-Control-Allow-Origin', '*')
      .expect(403, done);
  });

  it('GET /example.com without origin', function(done) {
    request(cors_anywhere)
      .get('/example.com/')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(403, done);
  });
});

describe('requireHeader', function() {
  before(function() {
    cors_anywhere = createServer({
      requireHeader: ['origin', 'x-requested-with'],
    });
    cors_anywhere_port = cors_anywhere.listen(0).address().port;
  });
  after(stopServer);

  it('GET /example.com without header', function(done) {
    request(cors_anywhere)
      .get('/example.com/')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(400, 'Missing required request header. Must specify one of: origin,x-requested-with', done);
  });

  it('GET /example.com with X-Requested-With header', function(done) {
    request(cors_anywhere)
      .get('/example.com/')
      .set('X-Requested-With', '')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, done);
  });

  it('GET /example.com with Origin header', function(done) {
    request(cors_anywhere)
      .get('/example.com/')
      .set('Origin', 'null')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, done);
  });
});

describe('removeHeaders', function() {
  before(function() {
    cors_anywhere = createServer({
      removeHeaders: ['cookie', 'cookie2'],
    });
    cors_anywhere_port = cors_anywhere.listen(0).address().port;
  });
  after(stopServer);

  it('GET /example.com with request cookie', function(done) {
    request(cors_anywhere)
      .get('/example.com/echoheaders')
      .set('cookie', 'a')
      .set('cookie2', 'b')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com',
      }, done);
  });

  it('GET /example.com with unknown header', function(done) {
    request(cors_anywhere)
      .get('/example.com/echoheaders')
      .set('cookie', 'a')
      .set('cookie2', 'b')
      .set('cookie3', 'c')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com',
        cookie3: 'c',
      }, done);
  });
});

describe('setHeaders', function() {
  before(function() {
    cors_anywhere = createServer({
      setHeaders: {'x-powered-by': 'CORS Anywhere'},
    });
    cors_anywhere_port = cors_anywhere.listen(0).address().port;
  });
  after(stopServer);

  it('GET /example.com', function(done) {
    request(cors_anywhere)
      .get('/example.com/echoheaders')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com',
        'x-powered-by': 'CORS Anywhere'
      }, done);
  });

  it('GET /example.com should replace header', function(done) {
    request(cors_anywhere)
      .get('/example.com/echoheaders')
      .set('x-powered-by', 'should be replaced')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com',
        'x-powered-by': 'CORS Anywhere'
      }, done);
  });
});

describe('setHeaders + removeHeaders', function() {
  before(function() {
    // setHeaders takes precedence over removeHeaders
    cors_anywhere = createServer({
      removeHeaders: ['x-powered-by'],
      setHeaders: {'x-powered-by': 'CORS Anywhere'},
    });
    cors_anywhere_port = cors_anywhere.listen(0).address().port;
  });
  after(stopServer);

  it('GET /example.com', function(done) {
    request(cors_anywhere)
      .get('/example.com/echoheaders')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com',
        'x-powered-by': 'CORS Anywhere'
      }, done);
  });

  it('GET /example.com should replace header', function(done) {
    request(cors_anywhere)
      .get('/example.com/echoheaders')
      .set('x-powered-by', 'should be replaced')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com',
        'x-powered-by': 'CORS Anywhere'
      }, done);
  });
});

describe('httpProxyOptions.xfwd=false', function() {
  before(function() {
    cors_anywhere = createServer({
      httpProxyOptions: {
        xfwd: false
      }
    });
    cors_anywhere_port = cors_anywhere.listen(0).address().port;
  });
  after(stopServer);

  it('X-Forwarded-* headers should not be set', function(done) {
    request(cors_anywhere)
      .get('/example.com/echoheaders')
      .set('test-include-xfwd', '')
      .expect('Access-Control-Allow-Origin', '*')
      .expectJSON({
        host: 'example.com',
      }, done);
  });
});

describe('httpProxyOptions.getProxyForUrl', function() {
  var proxy_server;
  var proxy_url;
  before(function() {
    // Using a real server instead of a mock because Nock doesn't can't mock proxies.
    proxy_server = http.createServer(function(req, res) {
      res.end(req.method + ' ' + req.url + ' Host=' + req.headers.host);
    });
    proxy_url = 'http://127.0.0.1:' + proxy_server.listen(0).address().port;

    cors_anywhere = createServer({
      httpProxyOptions: {
        xfwd: false
      }
    });
    cors_anywhere_port = cors_anywhere.listen(0).address().port;
  });
  afterEach(function() {
    // Assuming that they were not set before.
    delete process.env.https_proxy;
    delete process.env.http_proxy;
    delete process.env.no_proxy;
  });
  after(function(done) {
    proxy_server.close(function() {
      done();
    });
  });
  after(stopServer);

  it('http_proxy should be respected for matching domains', function(done) {
    process.env.http_proxy = proxy_url;

    request(cors_anywhere)
      .get('/http://example.com')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, 'GET http://example.com/ Host=example.com', done);
  });

  it('http_proxy should be ignored for http URLs', function(done) {
    process.env.http_proxy = proxy_url;
    request(cors_anywhere)
      .get('/https://example.com')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, 'Response from https://example.com', done);
  });

  it('https_proxy should be respected for matching domains', function(done) {
    process.env.https_proxy = proxy_url;

    request(cors_anywhere)
      .get('/https://example.com')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, 'GET https://example.com/ Host=example.com', done);
  });

  it('https_proxy should be ignored for http URLs', function(done) {
    process.env.https_proxy = proxy_url;
    request(cors_anywhere)
      .get('/http://example.com')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, 'Response from example.com', done);
  });

  it('https_proxy + no_proxy should not intercept requests in no_proxy', function(done) {
    process.env.https_proxy = proxy_url;
    process.env.no_proxy = 'example.com:443';
    request(cors_anywhere)
      .get('/https://example.com')
      .expect('Access-Control-Allow-Origin', '*')
      .expect(200, 'Response from https://example.com', done);
  });
});
