window.HydnaStream = (function() {
var DEFAULT_SWF_LOCATION = 'http://static.hydna.net/flash/socket.swf'
  , DEFAULT_DEPS_LOCATION = 'http://static.hydna.net/js/flash_ws_deps.js';

var MAX_PAYLOAD_SIZE = 10240;

// Ready states
var CONNECTING = 0
  , OPEN = 1
  , CLOSING = 2
  , CLOSED = 3;

// Op codes
var OPEN = 0x1
  , DATA = 0x2
  , SIGNAL = 0x3;
  
// Modes
var READ = 0x1
  , WRITE = 0x2
  , READWRITE = 0x3
  , EMIT = 0x4;

// Open Flags
var OPENSUCCESS         = 0x0
  , OPENREDIRECT        = 0x1
  , OPENFAILNA          = 0x8
  , OPENFAILMODE        = 0x9
  , OPENFAILPROTOCOL    = 0xa
  , OPENFAILHOST        = 0xb
  , OPENFAILAUTH        = 0xc
  , OPENFAILSERVICEERR  = 0xd
  , OPENFAILSERVICENA   = 0xe
  , OPENFAILOTHER       = 0xf;

// Signal flags    
var SIGEMIT             = 0x0
  , SIGEND              = 0x1
  , SIGERRPROTOCOL      = 0xa
  , SIGERROPERATION     = 0xb
  , SIGERRLIMIT         = 0xc
  , SIGERRSERVER        = 0xd
  , SIGERRVIOLATION     = 0xe
  , SIGERROTHER         = 0xf;

// Error classes
var ERROPEN             = 10
  , ERRSIG              = 20;

var ADDR_EXPR_RE = /^(?:([0-9a-f]{1,8})-|([0-9a-f]{1,8})-([0-9a-f]{1,8}))$/i;
var MODE_RE = /^(r|read){0,1}(w|write){0,1}(?:\+){0,1}(e|emit){0,1}$/i;
var URI_RE = /(?:hydna:){0,1}([\w\-\.]+)(?::(\d+)){0,1}(?:\/(\d+|x[a-fA-F0-9]{8}){0,1}){0,1}(?:\?(.+)){0,1}/;

var indexOf = Array.prototype.indexOf;

var connections = {};

if (!indexOf) {
  indexOf = function(obj) {
    for (var i = 0, l = this.length; i < l; i++) {
      if (this[i] === obj) {
        return i;
      }
    }
    return -1;
  }
}

// Stream

function Stream(rawuri, mode, token, options) {
  var self = this;
  var o = options || {};
  var transport = o.transport || null;
  var uri = parseuri(rawuri);
  var binmode = getbinmode(mode);
  var addr = uri.addr || 1;
  var data = token || uri.token || "";
  var host = uri.host;
  var port = uri.port;
  
  if (!host) {
    throw new Error("Expected hostname in uri");
  }
  
  if (addr < 0 || addr > 0xFFFFFFFF) {
    throw new Error("Invalid addr. Expected no between 0 and 0xFFFFFF");
  }
  
  if (data.length > MAX_PAYLOAD_SIZE) {
    throw new Error("Provided token exceeds max limit");
  }
  
  // Auto-detect best communication transport.
  if (!transport) {
    if (typeof window.WebSocket != 'undefined') {
      transport = "ws";
    } else if (flashPluginAvailable()) {
      transport = "flash";
    } else {
      transport = "polling";
    }
  }
  
  if (transport == "flash" && !flashPluginAvailable()) {
    throw new Error("Flash plugin required for this transport.");
    return;
  }

  self._transport = transport;

  self.readyState = CONNECTING;

  self._connection = null;
  self._encoding = null;

  self._request = null;
  self._writequeue = null;

  self._host = host;
  self._addr = addr;
  self._mode = binmode;

  self.readable = (binmode & READ) == READ;
  self.writable = (binmode & WRITE) == WRITE;
  self.emitable = (binmode & EMIT) == EMIT;
  
  function connect() {
    var packet;

    packet = { o: OPEN << 4 | binmode
             , a: addr
             , d: data
             };

    self._request = new OpenRequest(self, packet);

    try {
      self._connection = getconnection(transport, host, port, false);
    } catch(ctorerror) {
      setTimeout(function() {
        self.onerror(ctorerror);
      }, 1);
      return;
    }

    self._connection._streamcount++;

    setTimeout(function() {
      openstream(self._request);
    }, 0);
  }

  if (transport == "flash") {
    embedFlash(o, connect);
  } else {
    connect();
  }
}

Stream.prototype.send = function(data, priority) {
  var flag = priority || 0;
  var packet;

  if (!data || !data.length) {
    throw new Error("Expected data");
  }

  if (!this.writable) {
    throw new Error("Stream is not writable.");
  }

  if (data.length > MAX_PAYLOAD_SIZE) {
    throw new Error("Size of payload must not exceed MAX_PAYLOAD_SIZE.");
  }

  packet = { o: DATA << 4 | flag
           , a: this._addr
           , d: data
           };

  return writestream(this, packet);
};

Stream.prototype.emit = function(data) {
  var packet;
  
  if (!data || !data.length) {
    throw new Error("Expected data");
  }

  if (!this.emitable) {
    throw new Error("Stream is not emitable.");
  }

  if (data.length > MAX_PAYLOAD_SIZE) {
    throw new Error("Size of payload must not exceed MAX_PAYLOAD_SIZE.");
  }

  packet = { o: SIGNAL << 4 | SIGEMIT
           , a: this._addr
           , d: data
           };

  return writestream(this, packet);
};

Stream.prototype.end = function(data) {
  var request = this._request;
  var packet;
  
  if (this.readyState == CLOSED || this.readyState == CLOSING) {
    return;
  }

  if (request && !data && cancelopenstream(request)) {
    this._request = undefined;
    destroystream(this);
    return;
  }
  
  packet = { o: SIGNAL << 4 | SIGEND
           , a: this._addr
           , d: data || "" };

  writestream(this, packet);

  if (!request) {
    destroystream(this);
  } else {
    this.readyState = CLOSING;
    this.readable = false;
    this.writable = false;
    this.emitable = false;
  }
};

Stream.prototype.onopen = function(event) {};
Stream.prototype.onmessage = function(event) {};
Stream.prototype.onsignal = function(event) {};
Stream.prototype.onclose = function(event) {};
Stream.prototype.onerror = function(event) {};

Stream.CONNECTING = Stream.prototype.CONNECTING = CONNECTING;
Stream.OPEN = Stream.prototype.OPEN = OPEN;
Stream.CLOSING = Stream.prototype.CLOSING = CLOSING;
Stream.CLOSED = Stream.prototype.CLOSED = CLOSED;

function OpenRequest(stream, packet) {
  this.stream = stream;
  this.packet = packet;
  this.sent = false;
}

function StreamError(cls, code, message) {
  this.name = "StreamError";
  this.cls = cls;
  this.message = message;
  
  if (typeof code == "undefined" || code < 0 || code > 0xf) {
    switch (cls) {
      case ERROPEN: this.code = OPENFAILOTHER; break;
      default: this.code = SIGERROTHER; break;
    }
  } else {
    this.code = code;
  }

  if (!message) {
    switch (cls + code) {
      case ERROPEN + OPENFAILNA:
        this.message = "Stream is not available";
        break;
      case ERROPEN + OPENFAILMODE:
        this.message = "Not allowed to open stream with specified mode";
        break;
      case ERROPEN + OPENFAILPROTOCOL:
        this.message = "Not allowed to open stream with specified protocol";
        break;
      case ERROPEN + OPENFAILHOST:
        this.message = "Not allowed to open stream from host";
        break;
      case ERROPEN + OPENFAILAUTH:
        this.message = "Not allowed to open stream with credentials";
        break;
      case ERROPEN + OPENFAILSERVICENA:
        this.message = "Failed to open stream, service is not available";
        break;
      case ERROPEN + OPENFAILSERVICEERR:
        this.message = "Failed to open stream, service error";
        break;
      case ERROPEN + OPENFAILOTHER:
        this.message = "Failed to open stream, unknown error";
        break;
      case ERRSIG + SIGERRPROTOCOL:
        this.message = "Protocol error";
        break;
      case ERRSIG + SIGERROPERATION:
        this.message = "Operational error";
        break;
      case ERRSIG + SIGERRLIMIT:
        this.message = "Limit error";
        break;
      case ERRSIG + SIGERRSERVER:
        this.message = "Server error";
        break;
      case ERRSIG + SIGERRVIOLATION:
        this.message = "Violation error";
        break;
      case ERRSIG + SIGERROTHER:
        this.message = "Unknown error";
        break;
    }
  }
}

StreamError.prototype.toString = function() {
  var cls;
  switch (this.cls) {
    case ERROPEN: cls = "OPENERR"; break;
    default: cls = "STREAMERR"; break;
  }
  return cls + " 0x" + this.code + ": " + this.message;
}

function writestream(stream, packet) {
  if (stream._writequeue) {
    stream._writequeue.push(packet);
    return;
  }

  if (stream.readyState == CONNECTING) {
    stream._writequeue = [packet];
    return;
  }

  if (stream._connection.readyState == OPEN && stream.writable) {
    return stream._connection.send(JSON.stringify(packet));
  }

  destroystream(self, new Error("Stream is not writable."));
}

function destroystream(stream, exception) {
  var connection = stream._connection;
  var streams;

  if (stream._addr == null) {
    return;
  }

  if (connection) {
    streams =  connection._streams;
    if (streams[stream._addr] == stream) {
      delete streams[stream._addr];
    }
    
    connection._streamcount--;

    if (!connection._streamcount) {
      delete connections[connection.url];
    }

    stream._connection = null;
  }

  stream._connection = null;
  stream._writequeue = [];

  stream._host = null;
  stream._addr = null;
  stream._mode = null;
  stream._token = null;

  stream.readable = false;
  stream.writable = false;
  stream.emitable = false;
  stream.readyState = CLOSED;

  if (exception) {
    stream.onerror({
      error: exception
    });
  }

  stream.onclose({});
}

function destroystreams(streams, error) {
  var stream;
  for (var addr in streams) {
    if ((stream = streams[addr])) {
      destroystream(stream, error);
    }
  }
}

function getconnection(transport, host, port, secure) {
  var ispolling = transport == "polling";
  var url;
  var connection;
  var protocol;
  
  if (ispolling) {
    protocol = secure && "https://" || "http://";
    url = protocol + host + (port ? ":" + port : "") + "/";
  } else {
    protocol = secure && "wss://" || "ws://";
    url = protocol + host + (port ? ":" + port : "") + "/";
  }

  if ((connection = connections[url])) {
    return connection;
  }
  
  connection = ispolling && new PollingSocket(url) || new WebSocket(url);
  
  connection._streamcount = 0;
  connection._streams = {};
  connection._pending = {};
  connection._openqueue = {};
  connection._lasterror = null;

  connection.onmessage = function(event) {
    var streams = this._streams;
    var pending = this._pending;
    var queue = this._openqueue;
    var request;
    var packet;
    var target;
    
    if (typeof event.data == "string") {
      try {
        packet = JSON.parse(event.data);
      } catch (decodingErr) {
        this.destroy(new Error("Server sent a malformed packet."));
        return;
      }
    } else {
      packet = event.data;
    }

    if (!packet || 
        typeof packet.o !== "number" ||
        packet.o > 0xFF || packet.o < 0x00 ||
        typeof packet.a !== "number" ||
        packet.a > 0xFFFFFFFF || packet.a < 0x00 ||
        !("d" in packet)) {
      this.destroy(new Error("Server sent a malformed packet."));
      return;
    }
    
    flag = packet.o & 0xf;
    addr = packet.a;
    
    switch (packet.o >> 4) {
      case OPEN:
        var response;

        if (!(target = pending[addr])) {
          this.destroy(new Error("Server sent an open response to unknown"));
          return;
        }

        if (streams[addr]) {
          this.destroy(new Error("Server sent open to already open stream"));
          return;
        }
        
        if (flag == OPENSUCCESS) {
          streams[addr] = target.stream;
          response = addr;
        } else if (flag == OPENREDIRECT) {
          response = parseInt(packet.d);
          if (isNaN(response) || packet.d < 0x0 || packet.d > 0xFFFFFFFF) {
            this.destroy(new Error("Server sent a mallformed packet."));
            return;
          }
          streams[response] = target.stream;
        } else if (flag >= OPENFAILNA) {
          response = packet.d || "";
        } else {
          this.destroy(new Error("Server sent a mallformed packet"));
        }
        
        if (queue[addr] && queue[addr].length) {

          // Destroy all pending requests IF response wasn't a
          // redirected stream.
          if (flag == OPENSUCCESS) {
            pending[addr] = undefined;
            while ((request = queue[addr].pop())) {
              destroystream(request.stream, new Error("Stream already open"));
            }
            delete queue[addr];
          } else {
            pending[addr] = queue[addr].pop();

            if (!queue[addr].length) {
              delete queue[addr];
            }

            try {
              this.send(JSON.stringify(pending[addr].packet));
              pending[addr].sent = true;
            } catch (writeException) {
              this.destroy(writeException);
              return;
            }
          }
        } else {
          pending[addr] = undefined;
        }

        handleopenresponse(target.stream, flag, response);
        break;
        
      case DATA:
        if (addr == 0) {
          broadcastdata("message", streams, packet.d);
        } else if ((target = streams[addr])) {
          handledata("message", target, packet.d);
        }
        break;
        
      case SIGNAL:
        if (flag == SIGEMIT) {
          if (addr == 0) {
            broadcastdata("signal", streams, packet.d);
          } else if ((target = streams[addr])) {
            handledata("signal", target, packet.d);
          }
        } else if (flag == SIGEND) {
          if (addr == 0) {
            destroystreams(streams);
          } else if ((target = streams[addr])) {
            destroystream(target);
          }
        } else if (flag >= SIGERRPROTOCOL) {
          exception = packet.d.length || null;
          if (addr == 0) {
            this.destroy(new StreamError(ERRSIG, flag, exception));
          } else if ((target = streams[addr])) {
            destroystream(target, new StreamError(ERRSIG, flag, exception));
          }
        } else {
          this.destroy(new Error("Server sent an unknown signal flag"));
          return;
        }
        break;
        
      default:
        this.destroy(new Error("Server sent bad operator"));
        break;
    }
  };

  connection.onopen = function(event) {
    var pending = this._pending;
    var request;

    for (var addr in pending) {
      if ((request = pending[addr])) {
        this.send(JSON.stringify(request.packet));
        request.sent = true;
      }
    }
  }

  connection.onerror = function(event) {
    this._lasterror = event;
  }

  connection.onclose = function(event) {
    var streams = this._streams;
    var pending = this._pending;
    var queue = this._openqueue;
    var stream;
    var request;
    var error;

    error = this._lasterror || new Error("Connection closed by server");

    for (var addr in streams) {
      if ((stream = streams[addr])) {
        destroystream(stream, error);
      }
    }

    for (var addr in pending) {
      if ((request = pending[addr])) {
        destroystream(request.stream, error);
      }
    }
        
    for (var addr in queue) {
      if ((request = pending[addr])) {
        while ((request = queue.pop())) {
          destroystream(request.stream, error);
        }
      }
    }

    this._streams = undefined;
    this._pending = undefined;
    this._openqueue = undefined;

    delete connections[this.url];
  }
  
  connection.destroy = function(error) {
    console.log("DESTROY WITH ERROR: " + error);
    this._lasterror = error;
    this.close();
  }

  connections[url] = connection;

  return connection;
}

function handleopenresponse(stream, flag, response) {
  var queue = stream._writequeue;

  stream._writequeue = null;
  stream._request = null;
  
  if (flag >= OPENFAILNA) {
    destroystream(stream, new StreamError(ERROPEN, flag, response));
    return;
  }
  
  if (queue && queue.length) {
    for (var i = 0, l = queue.length; i < l; i++) {
      packet = queue[i];
      if (response != packet.a) {
        packet.a = response;
      }
      writestream(stream, packet);
    }
  }

  stream._addr = response;
  
  if (stream.readyState == CLOSING) {
    destroystream(stream);
  } else {
    stream.readyState = OPEN;
    stream.onopen && stream.onopen();
  }
}

// Handle DATA sent by server
function handledata(eventname, stream, data, flag) {
  var encoding = stream._encoding;
  var graph = data;
  var callback;

  if (encoding == "json") {
    try {
      graph = JSON.parse(data);
    } catch (exception) {
      destroystream(stream, exception);
      return;
    }
  } else {
    graph = data;
  }
  
  if ((callback = stream["on" + eventname]) && 
      typeof callback == "function") {
    callback(graph, flag);
  }
}

// Handle broadcast DATA sent by server
function broadcastdata(eventname, streams, data) {
  for (var key in streams) {
    handledata(eventname, streams[key], data);
  }
}



function openstream(request) {
  var stream = request.stream;
  var connection = stream._connection;
  var streams = connection._streams;
  var pending = connection._pending;
  var queue = connection._openqueue;
  var addr = stream._addr;
  
  if (!streams) {
    return;
  }

  if (streams[addr]) {
    destroystream(request.stream, new Error("Stream already open"));
    return;
  }

  if (pending[addr]) {
    if (!queue[addr]) {
      queue[addr] = [];
    }
    queue[addr].push(request);
    return;
  } else {
    pending[addr] = request;
    if (connection.readyState == OPEN) {
      try {
        connection.send(JSON.stringify(request.packet));
        request.sent = true;
      } catch (writeError) {
        connection.destroy(writeError);
      }
    }
  }
}

function cancelopenstream(request) {
  var stream = request.stream;
  var connection = stream._connection;
  var waitqueue = connection._openqueue;
  var pending = connection._pendingOpenRequests;
  var addr = request.addr;
  var queue;
  
  if (request.sent) {
    return false;
  }
  
  queue = waitqueue[addr];
  
  if (pending[addr]) {
    
    if (queue && queue.length)  {
      pending[addr] = queue.pop();
    } else {
      delete pending[addr];
    }
    
    return true;
  }
  
  // Should not happen...
  if (queue == null) {
    return false;
  }
  
  index = indexOf.apply(queue, request);
  
  if (index != -1) {
    queue.splice(index, 1);
    return true;
  }
  
  return false;
}

function getbinmode(modeExpr) {
  var result = 0;
  var match;

  if (!modeExpr) {
    return 0;
  }

  if (typeof modeExpr !== "string" || !(match = modeExpr.match(MODE_RE))) {
    return null;
  }

  match[1] && (result |= READ);
  match[2] && (result |= WRITE);
  match[3] && (result |= EMIT);

  return result;
}

function toHex(value, radix) {
  var r = value.toString(16);

  while (r.length < (radix || 8)) {
    r = "0" + r;
  }

  return r;
}

function flashPluginAvailable() {
  if (typeof navigator.plugins != 'undefined' &&
    typeof navigator.plugins['Shockwave Flash'] == 'object' &&
    navigator.plugins['Shockwave Flash'].description) {
    return true;
  }
  if (typeof this.window.ActiveXObject != 'undefined' &&
    new ActiveXObject('ShockwaveFlash.ShockwaveFlash')) {
    return true;
  }   
  return false;
}

function embedFlash(options, callback) {
  var script;
  
  if (!(script = document.getElementById("--hydna-flash-websocket--"))) {
    window.WebSocket = undefined;
    window.WEB_SOCKET_SWF_LOCATION = options.swfpath || DEFAULT_SWF_LOCATION;
    window.WEB_SOCKET_DEBUG = false;

    script = document.createElement('script')
    script.id = "--hydna-flash-websocket--";
    script.type = 'text/javascript';
    script.src = options.depspath || DEFAULT_DEPS_LOCATION;
    script.async = true;
    script._callbacks = [];
    script.onload = script.readystatechange = function() {
      if (typeof this.readyState == 'undefined' ||
        this.readyState == 'loaded' ||
        this.readyState == 'complete') {
        script.onload = script.readystatechange = null;
        for (var i = 0; i < script._callbacks.length; i++) {
          script._callbacks[i]();
        }
        script._callbacks = null;
      }
    }
    document.getElementsByTagName('head')[0].appendChild(script)
  }
  
  if (script._callbacks) {
    script._callbacks.push(callback);
  } else {
    callback && callback();
  }
}


function parseuri(s) {
  var m = URI_RE.exec(s) || [];
  return { host: m[1]
         , port: m[2]
         , addr: (m[3] && m[3][0] == 'x' ? parseInt('0' + m[3]) : parseInt(m[3]))
         , token: m[4] };
}

var LPCALLBACK = "__hydnadispatch";
var LPFRAME = "hydna-polling-frame-";
var LPFORM = "hydna-polling-form-";

var pollingsockets = {};

function PollingSocket(handshakeurl) {
  var url;
  var params;
  var id;
  var callback;
  
  while (pollingsockets[(id = Math.floor(Math.random()*10001))]) {}
  
  callback = LPCALLBACK + id;
  
  this.readyState = CONNECTING;

  this._listenurl = null;

  this._id = id;
  this._script = null;
  this._form = null;
  this._sending = false;
  this._buffer = [];
  this._postjobrunning = false;

  window[callback] = createDispatchWrapper(this);
  
  pollingsockets[id] = this;

  this._insertscript(handshakeurl + "?callback=" + callback);  
}

PollingSocket.prototype.onopen = function(event) {};
PollingSocket.prototype.onmessage = function(event) {};
PollingSocket.prototype.onclose = function(event) {};
PollingSocket.prototype.onerror = function(event) {};

PollingSocket.prototype.send = function(data) {

  if (this.readyState != OPEN) {
    throw new Error("PollingSocket is not ready");
  }
  
  this._buffer.push(data);

  !this._postjobrunning && this._startPostJob();
}

PollingSocket.prototype.close = function() {
  if (this.readyState == OPEN) {
    console.log("CLOOOOOOOOOSING");

    this._buffer.push("");

    !this._postjobrunning && this._startPostJob();
  }
  this.readyState = CLOSING;
}

PollingSocket.prototype._startPostJob = function() {
  var self = this;
  var id = this._id;
  var body;
  
  body = document.getElementsByTagName('body')[0];

  this._postjobrunning = true;
  
  function post() {
    var frameid = LPFRAME + id;
    var formid = LPFORM + id;
    var form;
    var iframe;
    var textarea;
    var url;

    if (self._form) {
      body.removeChild(self._form);
    }
    
    form = document.createElement('form');
    form.id = formid;
    form.target = frameid;
    form.method = 'POST';
    form.action = self._listenurl;
    form.style.height = '0px';
    form.style.width = '0px';
    form.style.position = 'absolute';
    form.style.top = '-10000px';

    body.appendChild(form);

    self._form = form;

    textarea = document.createElement('textarea');
    textarea.name = 'data';
    form.appendChild(textarea);
    textarea.value = "[" + self._buffer.join(",") + "]";
    
    // Reset buffer
    self._buffer = [];
    
    // http://stackoverflow.com/questions/875650/why-does-ie-open-form-submission-in-a-new-window-and-not-dynamically-inserted-ifr
    try {
      iframe = document.createElement('<iframe name="' + frameid + '">');
    } catch(err) {
      iframe = document.createElement('iframe');
      iframe.name = frameid;
    }
    
    iframe.id = frameid;
    iframe.src = 'about:blank';
    
    iframe.onload = iframe.onreadystatechange = function() {

      if (typeof this.readyState == 'undefined' ||
        this.readyState == 'loaded' ||
        this.readyState == 'complete') {
        iframe.onload = iframe.onreadystatechange = null;
        // reset the source to the original to prevent browser from displaying
        // a confirmation box.
        iframe.src = 'about:blank';

        if (self._buffer.length) {
          setTimeout(post, 5);
        } else {
          self._postjobrunning = false;
        }
      }
    }
    
    form.appendChild(iframe);
    form.submit();  
  }

  setTimeout(post, 5);
}

PollingSocket.prototype._listen = function() {
  var self = this;

  this._insertscript(this._listenurl, function() {
    self._listen();
  });
}

PollingSocket.prototype._insertscript = function(url, callback) {
  var self = this;
  var head;
  var script;

  head = document.getElementsByTagName('head')[0];
  
  if (this._script) {
    head.removeChild(this._script);
    this._script == null;
  }
  
  script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = url + "&r=" + Math.floor(Math.random()*10001);
  script.async = true;
  script.transport = this;
  
  script.onload = function() {
    callback && callback();
  }

  script.onerror = function() {
    console.log("Script error");
    self._destroy(new Error("Server communication error"));
  }

  script.onreadystatechange = function() {
    if (this.getAttribute('data-loaded') == 'undefined') {
      this.setAttribute('data-loaded', false);
    }
    if (this.readyState == 'loaded' || this.readyState == 'complete') {
      script.onreadystatechange = null;
      // the global dispatcher will set the data-loaded-attribute of
      // the script element when data has been sucessfully retrieved.
      if (!this.getAttribute('data-loaded')) {
        self._destroy(new Error("Server communication error"));
        return;
      } 
      
      callback && callback();
    }
  }

  head.appendChild(script);
  
  this._script = script;
}

PollingSocket.prototype._destroy = function(error) {
  var head;
  var body;

  if (this.readyState == CLOSED) {
    return;
  }

  if (this._script) {
    head = document.getElementsByTagName('body')[0];
    try { head.removeChild(this._script) } catch(e) {}
    this._script = null;
  }

  if (this._form) {
    body = document.getElementsByTagName('body')[0];
    try { body.removeChild(this._form) } catch(e) {}
    this._form = null;
  }

  delete pollingsockets[this._id];
  try {
      delete window[LPCALLBACK + this._id];
  } catch (e) {
      // a bug in IE prevents us from deleting properties on the window object
      window[LPCALLBACK + this._id] = undefined;
  }

  this.readyState = CLOSED;
  
  if (error) {
    this.onerror(error);
  } 
  
  this.onclose({});
}

function createDispatchWrapper(socket) {
  return function(graph) {
    var packets;
    
    socket._script.setAttribute('data-loaded', true);

    if (graph === null || graph === void(0)) {
      socket._destroy();
      return;
    }
    
    if (socket.readyState == CONNECTING) {
     
      if (!graph.listenurl) {
        socket._destroy(new Error("Server sent bad handshake"));
      } else {
        socket.readyState = OPEN;
        socket._listenurl = graph.listenurl;
        socket._listen();
        socket.onopen({});
      }
      
      return;
    }

    packets = graph.length && graph || [graph];

    for (var i = 0, l = packets.length; i < l; i++) {
    
      if (this.readyState == CLOSING || this.readyState == CLOSED) {
        break;
      }
      
      socket.onmessage({data: packets[i]});
    }
  }
}
return Stream; })();
// json2
if (typeof JSON == "undefined") {
    eval(function(p,a,c,k,e,d){e=function(c){return(c<a?'':e(parseInt(c/a)))+((c=c%a)>35?String.fromCharCode(c+29):c.toString(36))};if(!''.replace(/^/,String)){while(c--){d[e(c)]=k[c]||e(c)}k=[function(e){return d[e]}];e=function(){return'\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('3(!e.m){e.m={}}(5(){"1y 1W";5 f(n){7 n<10?\'0\'+n:n}3(6 1p.A.w!==\'5\'){1p.A.w=5(l){7 1a(e.17())?e.1Z()+\'-\'+f(e.1J()+1)+\'-\'+f(e.1w())+\'T\'+f(e.1C())+\':\'+f(e.1E())+\':\'+f(e.1H())+\'Z\':C};Q.A.w=1S.A.w=1O.A.w=5(l){7 e.17()}}z N=/[\\1z\\1r\\1o-\\1h\\1g\\1f\\1e\\1i-\\1j\\1n-\\1m\\1l-\\1k\\1d\\15-\\14]/g,L=/[\\\\\\"\\1A-\\1x\\1Y-\\1G\\1r\\1o-\\1h\\1g\\1f\\1e\\1i-\\1j\\1n-\\1m\\1l-\\1k\\1d\\15-\\14]/g,8,H,13={\'\\b\':\'\\\\b\',\'\\t\':\'\\\\t\',\'\\n\':\'\\\\n\',\'\\f\':\'\\\\f\',\'\\r\':\'\\\\r\',\'"\':\'\\\\"\',\'\\\\\':\'\\\\\\\\\'},o;5 O(q){L.1b=0;7 L.12(q)?\'"\'+q.E(L,5(a){z c=13[a];7 6 c===\'q\'?c:\'\\\\u\'+(\'1t\'+a.1u(0).11(16)).1s(-4)})+\'"\':\'"\'+q+\'"\'}5 D(l,x){z i,k,v,h,K=8,9,2=x[l];3(2&&6 2===\'y\'&&6 2.w===\'5\'){2=2.w(l)}3(6 o===\'5\'){2=o.M(x,l,2)}1T(6 2){J\'q\':7 O(2);J\'S\':7 1a(2)?Q(2):\'C\';J\'1V\':J\'C\':7 Q(2);J\'y\':3(!2){7\'C\'}8+=H;9=[];3(W.A.11.1X(2)===\'[y 1R]\'){h=2.h;G(i=0;i<h;i+=1){9[i]=D(i,2)||\'C\'}v=9.h===0?\'[]\':8?\'[\\n\'+8+9.P(\',\\n\'+8)+\'\\n\'+K+\']\':\'[\'+9.P(\',\')+\']\';8=K;7 v}3(o&&6 o===\'y\'){h=o.h;G(i=0;i<h;i+=1){k=o[i];3(6 k===\'q\'){v=D(k,2);3(v){9.1c(O(k)+(8?\': \':\':\')+v)}}}}U{G(k 1q 2){3(W.1v.M(2,k)){v=D(k,2);3(v){9.1c(O(k)+(8?\': \':\':\')+v)}}}}v=9.h===0?\'{}\':8?\'{\\n\'+8+9.P(\',\\n\'+8)+\'\\n\'+K+\'}\':\'{\'+9.P(\',\')+\'}\';8=K;7 v}}3(6 m.V!==\'5\'){m.V=5(2,B,I){z i;8=\'\';H=\'\';3(6 I===\'S\'){G(i=0;i<I;i+=1){H+=\' \'}}U 3(6 I===\'q\'){H=I}o=B;3(B&&6 B!==\'5\'&&(6 B!==\'y\'||6 B.h!==\'S\')){19 18 1U(\'m.V\')}7 D(\'\',{\'\':2})}}3(6 m.Y!==\'5\'){m.Y=5(p,R){z j;5 X(x,l){z k,v,2=x[l];3(2&&6 2===\'y\'){G(k 1q 2){3(W.1v.M(2,k)){v=X(2,k);3(v!==1B){2[k]=v}U{1F 2[k]}}}}7 R.M(x,l,2)}p=Q(p);N.1b=0;3(N.12(p)){p=p.E(N,5(a){7\'\\\\u\'+(\'1t\'+a.1u(0).11(16)).1s(-4)})}3(/^[\\],:{}\\s]*$/.12(p.E(/\\\\(?:["\\\\\\/1L]|u[0-1N-1M-F]{4})/g,\'@\').E(/"[^"\\\\\\n\\r]*"|1K|1I|C|-?\\d+(?:\\.\\d*)?(?:[1D][+\\-]?\\d+)?/g,\']\').E(/(?:^|:|,)(?:\\s*\\[)+/g,\'\'))){j=1Q(\'(\'+p+\')\');7 6 R===\'5\'?X({\'\':j},\'\'):j}19 18 1P(\'m.Y\')}}}());',62,124,'||value|if||function|typeof|return|gap|partial|||||this|||length||||key|JSON||rep|text|string||||||toJSON|holder|object|var|prototype|replacer|null|str|replace||for|indent|space|case|mind|escapable|call|cx|quote|join|String|reviver|number||else|stringify|Object|walk|parse|||toString|test|meta|uffff|ufff0||valueOf|new|throw|isFinite|lastIndex|push|ufeff|u17b5|u17b4|u070f|u0604|u200c|u200f|u206f|u2060|u202f|u2028|u0600|Date|in|u00ad|slice|0000|charCodeAt|hasOwnProperty|getUTCDate|x1f|use|u0000|x00|undefined|getUTCHours|eE|getUTCMinutes|delete|x9f|getUTCSeconds|false|getUTCMonth|true|bfnrt|fA|9a|Boolean|SyntaxError|eval|Array|Number|switch|Error|boolean|strict|apply|x7f|getUTCFullYear'.split('|'),0,{}))
}