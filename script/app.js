$(document).ready(function() {
  
  // Game contants
  var HYDNA_URI = "public.hydna.net/";
  var HYDNA_ANNOUNCE_ID = 5000;
  var DELTA_TIME = 0.017;
  var PADDLE_THICKNESS = 10;
  var PADDLE_HEIGHT = 100;
  var PADDLE_PADDING = 10;
  var PADDLE_SPEED = 190;
  var BALL_SIZE = 8;
  var BALL_SPEED = 320;
  var SCENE_WIDTH = 852;
  var SCENE_HEIGHT = 480;
  var KEYUP = 38;
  var KEYDOWN = 40;
  var MAX_FIND_ATTEMPTS = 15;
  var ROOM_START_ADDR = 0x10000000;
  var ROOM_END_ADDR = 0xF0000000;
  var CONNECTION_TIMEOUT = 4000;
  var MAX_SCORE = 5;
  
  // Game variables
  var canvas = $("canvas");
  var status = $("header .status");
  var leftscore = $("header .your-score");
  var rightscore = $("header .opponent-score");
  var canvase = canvas.get(0);
  var ctx = canvase.getContext("2d");
  var keystates = {};
  var gamestate;
  var gamechan = null;
  var gameloopId;
  var leftPaddle;
  var rightPaddle;
  var ball;
  
  leftscore.score = 0;
  rightscore.score = 0;

  // Set the width and height of the canvas. We are running 
  // a multiplayer game, so each client must have the same 
  // scaling system. THe `canvas` element has it own built-in, 
  // so we are using that for drawing. 
  canvase.width = SCENE_WIDTH;
  canvase.height = SCENE_HEIGHT;
  
  $(window).bind('keydown', function(event) {
    // Handle `keydown` event. Set keystate of key 
    // to `true`. Ignore the key-down event, if paddle 
    // is not created.
  
    if (leftPaddle && (event.keyCode == KEYUP || event.keyCode == KEYDOWN)) {
      
      if (!leftPaddle.keystates[event.keyCode]) {
        leftPaddle.keystates[event.keyCode] = true;

        if (gamechan) {
          // Send update to game channel if exists.

          send(gamechan, { op: "action"
                           , states: leftPaddle.keystates
                           });
        }
      }
      
    }
  });

  $(window).bind('keyup', function(event) {
    // Handle `keyup` event. Set keystate of key 
    // to `false`. Ignore the key-down event, if paddle 
    // is not created.
    
    if (leftPaddle && (event.keyCode == KEYUP || event.keyCode == KEYDOWN)) {
      
      if (leftPaddle.keystates[event.keyCode]) {
        leftPaddle.keystates[event.keyCode] = false;

        if (gamechan) {
          // Send update to game channel if exists.

          send(gamechan, { op: "action"
                           , states: leftPaddle.keystates
                           });
        }
      }
    }
  });
  
  $("#info-dialog button").bind("click", function() {
    $("#info-dialog").hide();
    
    status.html("Setting up network connection...");
  
    // Put game in practice-mode.
    enterPracticeMode();

    claimStream(function(mychan, addr) {
      // A channel was claimed. Initialize the 
      // `announce` channel.

      var announce = new HydnaChannel(HYDNA_URI + HYDNA_ANNOUNCE_ID, 'rw');

      announce.onopen = function() {
        findGame(announce, mychan, addr);
      }
    });
  });
  
  function renderScene() {
    // Is called each game tick. Draw paddles and ball. 
    
    // Clear the game scene
    ctx.clearRect(0, 0, 852, 480);
    
    // Everything in the scene will be filled with
    // white, so it is safe to set fillstyle to 
    // `white` at the begining of the render loop.
    ctx.fillStyle = "white";
    
    if (leftPaddle) {
      // Draw leftPaddle, if exists

      ctx.fillRect( leftPaddle.pos.x
                  , leftPaddle.pos.y
                  , PADDLE_THICKNESS
                  , PADDLE_HEIGHT
                  );
      
    }
    
    if (rightPaddle) {
      // Draw rightPaddle, if exists
      
      ctx.fillRect( rightPaddle.pos.x
                  , rightPaddle.pos.y
                  , PADDLE_THICKNESS
                  , PADDLE_HEIGHT
                  );
      
    }
    
    if (ball) {
      // Draw ball, if exists
      
      ctx.fillRect( ball.pos.x
                  , ball.pos.y 
                  , BALL_SIZE
                  , BALL_SIZE);
    }
    
    
    // Draw the line in the middle.
    ctx.save()
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(SCENE_WIDTH / 2, 0);
    ctx.lineTo(SCENE_WIDTH / 2, SCENE_HEIGHT);
    ctx.stroke();

  }
  
  function movePaddles(delta) {
    // Move paddles based on keystate.
    
    if (leftPaddle) {
      
      if (leftPaddle.keystates[KEYUP]) { 
        leftPaddle.pos.y -= (PADDLE_SPEED * delta);
      } else if (leftPaddle.keystates[KEYDOWN]) {
        leftPaddle.pos.y += (PADDLE_SPEED * delta);
      }

      if (leftPaddle.pos.y + PADDLE_HEIGHT >= SCENE_HEIGHT) {
        leftPaddle.pos.y = SCENE_HEIGHT - PADDLE_HEIGHT;
      } else if (leftPaddle.pos.y < 0) {
        leftPaddle.pos.y = 0;
      }
      
      if ("y" in leftPaddle.remotepos && 
          Math.abs(leftPaddle.pos.y - leftPaddle.remotepos.y) > 0.01) {
        // Do a simple interpolation, to remove some lag.

        leftPaddle.pos.y += (leftPaddle.remotepos.y - leftPaddle.pos.y) / 50;
      }
      
    }
    
    if (rightPaddle) {


      if (rightPaddle.keystates[KEYUP]) { 
        rightPaddle.pos.y -= (PADDLE_SPEED * delta);
      } else if (rightPaddle.keystates[KEYDOWN]) {
        rightPaddle.pos.y += (PADDLE_SPEED * delta);
      }

      if (rightPaddle.pos.y + PADDLE_HEIGHT > SCENE_HEIGHT) {
        rightPaddle.pos.y = SCENE_HEIGHT - PADDLE_HEIGHT;
      } else if (rightPaddle.pos.y < 0) {
        rightPaddle.pos.y = 0;
      }
      
      if ("y" in rightPaddle.remotepos && 
          Math.abs(rightPaddle.pos.y - rightPaddle.remotepos.y) > 0.01) {
        // Do a simple interpolation, to remove some lag.

        rightPaddle.pos.y += (rightPaddle.remotepos.y - rightPaddle.pos.y) / 50;
      }
      
    }
  }
  
  function moveBall(delta) {
    // Moves ball by adding ball's velocity. 

    if (!ball) {
      return;
    }
    
    ball.pos.x += ball.vel.x * delta;
    ball.pos.y += ball.vel.y * delta;
  }
  
  function checkCollisions() {
    // Check ball collisions

    if (!ball) {
      return;
    }
    
    if (ball.pos.x < 0) {
      // Score for right paddle!
      
      if (gamestate == "practice-mode" || gamestate == "server-mode") {

        resetBall();

        rightscore.score++;
        rightscore.text(rightscore.score);

        if (gamechan) {
          send(gamechan, { op: "newball"
                           , ball: ball
                           , leftscore: leftscore.score
                           , rightscore: rightscore.score 
                           });
        }
      }
      
      return;
    } else if (ball.pos.x > SCENE_WIDTH) {
      // Score for left paddle! 

      if (gamestate == "practice-mode" || gamestate == "server-mode") {

        resetBall();

        leftscore.score++;
        leftscore.text(rightscore.score);

        if (gamechan) {
          send(gamechan, { op: "newball"
                           , ball: ball
                           , leftscore: leftscore.score
                           , rightscore: rightscore.score 
                           });
        }
      }

      return;
    }  
    
    
    if (ball.pos.y + BALL_SIZE > SCENE_HEIGHT || ball.pos.y < 0) {
      // Ball hit the top or bottom wall. Reverse the 
      // `y` velocity of the ball.
      
      ball.vel = { x: ball.vel.x
                 , y: -ball.vel.y 
                 };
    }
    
    if ( leftPaddle &&
         ball.pos.x < (leftPaddle.pos.x + PADDLE_THICKNESS) &&
         ball.pos.y >= (leftPaddle.pos.y) &&
         ball.pos.y <= (leftPaddle.pos.y + PADDLE_HEIGHT)) {
       // Ball collided with the left paddle. Reverse the 
       ball.vel = { x: -ball.vel.x
                  , y: ball.vel.y };
       
    }

    if ( rightPaddle &&
         ball.pos.x > (rightPaddle.pos.x - PADDLE_THICKNESS) &&
         ball.pos.y >= (rightPaddle.pos.y) &&
         ball.pos.y <= (rightPaddle.pos.y + PADDLE_HEIGHT)) {
       // Ball collided with the right paddle. Reverse the 
       ball.vel = { x: -ball.vel.x
                  , y: ball.vel.y };
       
    }
        
  }
  
  function getDots(count) {
    // An utility function that creates trailing dots.
    
    var dots = "";
    
    for (var i = 0; i < (count % 3) + 1; i++) {
      dots += ".";
    }
    
    return '<span class="dots">' + dots + '</span>'
  }
  
  function expectJson(callback) {
    // Check if an incomming message is of type 
    // JSON, if so, then call `callback`.

    return function(event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (jsonDecodeException) {
        return;
      }
      callback(msg);
    }    
  }
  
  function send(channel, msg) {
    // Encodes and send's a message to specified
    // `channel`.
    
    if (!channel) {
      return;
    }

    channel.send(JSON.stringify(msg));
  }
  
  function claimStream(callback) {
    // Create a new game by creating a new HydnaChannel on a
    // random address.
    
    var maxrooms = ROOM_END_ADDR - ROOM_START_ADDR;
    var addr = ROOM_START_ADDR + parseInt(Math.random() * ROOM_END_ADDR);
    var random = parseInt(Math.random() * 0xffffffff);
    var claimcount = 0;
    var channel;
    var claimTimeoutId;
    
    function claimCallback() {
      // Send out probe messages on channel. If 
      // nobody else has sent a message on channel
      // for 1 sec, then it is safe to claim the
      // channel.
      
      if (++claimcount == 10) {
        channel.onmessage = null;
        callback(channel, addr);
      } else {
        send(channel, { op: "claim", id: random });
        claimTimeoutId = setTimeout(claimCallback, 100);
      }
    }

    channel = new HydnaChannel(HYDNA_URI + addr, "rw");

    channel.onopen = claimCallback;
    
    channel.onmessage = expectJson(function(msg) {
      // Check if someone else has claimed
      // the channel already. If so, create 
      // a new random channel.
      
      if (msg.op !== "claim" || msg.id !== random) {

        channel.close();
        channel = null;

        clearTimeout(claimTimeoutId);

        setTimeout(function() {
          claimStream(callback);
        }, 0);
      }
      
    });
    
  }
  
  function enterPracticeMode() {
    // Set game state to practice mode. 
    
    gamestate = "practice-mode";
   
    // Reset game elements to start 
    // practice mode.
    resetBall();
    resetLeftPaddle();
    resetGameLoop(function() {});
  }
  
  function enterServerMode(mychan, remotechan) {
    var connectionTimeout = Date.now();
    var tick = 0;
    
    gamestate = "server-mode";
    gamechan = remotechan;
    
    leftscore.score = 0;
    rightscore.score = 0;
    
    function gametickCallback() {
      // Check if client is still connected, 
      // and if game is running. Send out
      // paddle and ball positions.

      if (connectionTimeout + CONNECTION_TIMEOUT < Date.now()) {
        // Client didn't send us a message within the 
        // CONNECTION_TIMEOUT limit. The game ends.
        
        leftPaddle = null;
        rightPaddle = null;
        ball = null;
        
        mychan.close();
        remotechan.close();
        gamechan = null;
        
        resetGameLoop();
        
        status.html("Remote user disconnected, refresh page to play again");
        return;
      }
      
      if (leftscore.score == MAX_SCORE || rightscore.score == MAX_SCORE) {
        
        send(remotechan, { op: "end"
                           , leftscore: leftscore.score
                           , rightscore: rightscore.score
                           });

        leftPaddle = null;
        rightPaddle = null;
        ball = null;

        mychan.close();
        remotechan.close();
        gamechan = null;

        resetGameLoop();
      
        leftscore.text(leftscore.score);
        rightscore.text(rightscore.score);
        
        if (leftscore.score > rightscore.score) {
          status.html("Game over, you won!");
        } else {
          status.html("Game over, opponent won!");
        }
       
        return;
      }
      
      tick++;
      
      if (tick % 10 == 0) {
        send(remotechan, { op: "update"
                           , p1: leftPaddle.pos.y
                           , p2: rightPaddle.pos.y
                           , ballvel: ball.vel
                           });
        
      }
    }
    
    mychan.onmessage = expectJson(function(msg) {
      switch (msg.op) {
        
        case "join":
          // A client is trying to connect to us, but 
          // we already have a client. Send back a 
          // reject message.
        
          send(channel, { op: "reject", id: msg.id });
          break;
          
        case "action":
          // Client has sent us an `action`. Update key-state for
          // right paddle.
                  
          if (rightPaddle) {
            rightPaddle.keystates = msg.states;
          }

          connectionTimeout = Date.now();        
          break;
        
        case "noaction":
        
          connectionTimeout = Date.now();        
          break;
      }
      
    });
    
    // Remove all game elements (that was created for)
    // practice mode.
    leftPaddle = null;
    rightPaddle = null;
    ball = null;
    
    status.html("Game starts in 2 seconds");
    
    send(remotechan, { op: "accept" });
    
    setTimeout(function() {
      // Start game in 2 seconds. 
      
      resetBall();
      resetLeftPaddle();
      resetRightPaddle();
      resetGameLoop(gametickCallback);
      
      leftscore.text(0);
      rightscore.text(0);
      
      send(remotechan, { op: "start"
                         , ball: ball
                         , leftscore: 0
                         , rightscore: 0 
                         });

      status.html("");
      
    }, 2000);
  }
  
  function enterClientMode(mychan, remotechan) {
    // Put game in client mode.
    
    var connectionTimeout = Date.now();
    var tick = 0;
    
    status.html("Game starts in 2 seconds");
    
    gamestate = "client-mode";
    gamechan = remotechan;
    
    leftscore.score = 0;
    rightscore.score = 0;
    
    function gametickCallback() {
      // Check if client is still connected, 
      // and if game is running. Send out
      // paddle and ball positions.
      
      if (connectionTimeout + CONNECTION_TIMEOUT < Date.now()) {
        // Remote part disconnected. 
        
        leftPaddle = null;
        rightPaddle = null;
        ball = null;
        
        mychan.close();
        remotechan.close();
        gamechan = null;
        
        resetGameLoop();
        
        status.html("Remote user disconnected, refresh page to play again");
        return;
      }
      
      tick++;
      
      if (tick % 30 == 0) {
        send(remotechan, { op: "noaction" });
      }
    }
    
    mychan.onmessage = expectJson(function(msg) {

      switch (msg.op) {
        
        case "start":
          // Game is started. Create paddles and initialize
          // ball.
        
          ball = msg.ball;
          ball.vel.x = -ball.vel.x;

          leftscore.text(msg.rightscore);
          rightscore.text(msg.leftscore);

          resetLeftPaddle();
          resetRightPaddle();
          resetGameLoop(gametickCallback);
        
          connectionTimeout = Date.now();
          
          status.html("");
          break;
          
        case "end":
          // Game ended. 
          
          leftPaddle = null;
          rightPaddle = null;
          ball = null;

          mychan.close();
          remotechan.close();
          gamechan = null;

          resetGameLoop();
        
          leftscore.text(msg.rightscore);
          rightscore.text(msg.leftscore);
          
          if (msg.rightscore > msg.leftscore) {
            status.html("Game over, you won!");
          } else {
            status.html("Game over, opponent won!");
          }
        
          break;
          
        case "newball":
        
          ball = msg.ball;
          ball.vel.x = -ball.vel.x;
          
          leftscore.text(msg.rightscore);
          rightscore.text(msg.leftscore);

          connectionTimeout = Date.now();
        
          break;
        
        case "update":
          // Server sent an `update` message. Update
          // all game elements. Note, the p1 and p2 
          // is reversed.

          ball.vel.x = -msg.ballvel.x;
          
          if (leftPaddle) {
            leftPaddle.remotepos.y = msg.p2;
          }

          if (rightPaddle) {
            rightPaddle.remotepos.y = msg.p1;
          }
          
          connectionTimeout = Date.now();
          break;
          
        case "action":
          // Client has sent us an `action`. Update key-state for
          // right paddle.
          
          if (rightPaddle) {
            rightPaddle.keystates = msg.states;
          }

          connectionTimeout = Date.now();
          break;
      }
      
    });
    
    // Remove all game elements (that was created for)
    // practice mode.
    leftPaddle = null;
    rightPaddle = null;
    ball = null;
    
  }
  
  function findGame(announcechan, mychan, addr) {
    var readycount = 0;
    var remotechan;
    var jointimerid;
    var ticktimerid;
    
    function tickCallback() {
      // Notify the user on the connection
      // process.

      readycount++;

      if (remotechan) {
        // Reset `readycount` if we got an 
        // `remotechan`. 
        
        readycount = 0;
      }

      if (readycount == MAX_FIND_ATTEMPTS) {
        // Stop trying to find a game, start a new 
        // game instead, and start waiting for an
        // opponent to join. Remove the event 
        // listener `onmessage`, we do not need to
        // answer does any more.
        
        announcechan.onmessage = null;
        mychan.onmessage = null;
        
        clearTimeout(ticktimerid);
        clearTimeout(jointimerid);
        
        createGame(announcechan, mychan, addr);

        return;
      }
      
      // Update status text, for user feedback..
      status.html("Searching for games" + getDots(readycount));

      ticktimerid = setTimeout(tickCallback, 500);
    }
    
    ticktimerid = setTimeout(tickCallback, 0);
    
    mychan.onmessage = expectJson(function(msg) {
      
      switch (msg.op) {

        case "reject":
          // Our request was rejected. Reset
          // `remotechan`, try to find an
          // other game instead.

          clearTimeout(jointimerid);

          remotechan.close();
          remotechan = null;
          break;

        case "accept":
          // The request was accepted. Do some
          // clean-up by stoping each timer, then
          // call `callback`.

          clearTimeout(jointimerid);
          mychan.onmessage = null;

          clearTimeout(ticktimerid);

          announcechan.close();

          enterClientMode(mychan, remotechan);
          break;
      }
    });
      
    announcechan.onmessage = expectJson(function(msg) {

      if (remotechan || msg.op !== "announce") {
        // Ignore the announcement if we currently
        // waiting for a response or if message
        // op isn't `announce`.

        return; 
      }

      remotechan = new HydnaChannel(HYDNA_URI + msg.id, "w");

      remotechan.onopen = function() {
        // Send a join request to channel with a randomly
        // created ID.

        send(remotechan, { op: "join", id: addr });
      }

      jointimerid = setTimeout(function() {
        // Give timeout one second to accept. 

        remotechan.close();
        remotechan = null;
      }, 1000);

    });
  }
  
  function createGame(announcechan, mychan, addr) {
    var readycount = 0;
    var ticktimerid;
    
    function tickCallback() {
      // Send out a ping message to announce channel and game
      // room channel. This let our opponent find us.
      
      readycount++;

      send(announcechan, {op: "announce", id: addr});
      send(mychan, {op: "announce", id: addr});
    
      // Update status text, for user feedback..
      status.html("Waiting for player to join" + getDots(readycount));
      
      ticktimerid = setTimeout(tickCallback, 500);
    }
    
    ticktimerid = setTimeout(tickCallback, 0);
    
    mychan.onmessage = expectJson(function(msg) {
      // A remote client is sending us a join 
      // request. Accept it and start game.
      var remotechan;

      if (msg.op == "join") {

        mychan.onmessage = null;
        
        clearTimeout(ticktimerid);

        announcechan.close();
        
        remotechan = new HydnaChannel(HYDNA_URI + msg.id, "w");

        remotechan.onopen = function() {
          enterServerMode(mychan, remotechan);
        }
      }
    });
    
  }
  
  function resetLeftPaddle() {
    // Create left paddle (this is you)

    leftPaddle = { pos: { x: PADDLE_PADDING
                        , y: PADDLE_PADDING
                        }
                 , remotepos: {}
                 , keystates: {} 
                 };

    leftPaddle.keystates[KEYUP] = false;
    leftPaddle.keystates[KEYDOWN] = false;
  }

  function resetRightPaddle() {
    // Create right paddle (this is you opponent)

    rightPaddle = { pos: { x: SCENE_WIDTH - PADDLE_THICKNESS - PADDLE_PADDING
                         , y: PADDLE_PADDING
                         }
                  , remotepos: {}
                  , keystates: {} 
                  };

    rightPaddle.keystates[KEYUP] = false;
    rightPaddle.keystates[KEYDOWN] = false;
  }
  
  function resetBall() {
    // Resets balls position (centers it) and randomly generates
    // it's starting angle.
    
    var angle;
    
    if (gamestate == "practice-mode") {
      // Set ball starting angle to target the 
      // left paddle. 

      angle = -127 - parseInt(Math.random() * 90);
    } else {
      // First randomize which direction to 
      // spawn. Then randomize the actuall 
      // angle
      
      if (Math.floor(Math.random() * 2)) {
        angle = -127 - parseInt(Math.random() * 90);
      } else {
        angle = -45 + parseInt(Math.random() * 90);
      }
    }
    
    ball = { pos: { x: (SCENE_WIDTH / 2) + (BALL_SIZE / 2)
                  , y: (SCENE_HEIGHT / 2) + (BALL_SIZE / 2)
                  }
           , vel: { x: Math.cos(angle * (Math.PI / 180)) * (BALL_SPEED) 
                  , y: Math.sin(angle * (Math.PI / 180)) * (BALL_SPEED)
                  }
           };
  }
  
  function resetGameLoop(tickCallback) {
    // Resets and start game loop.
    var currentTime = Date.now();
    var accumulator = 0;
    
    if (gameloopId) {
      // Kill the old game loop
      
      clearInterval(gameloopId);
    }
    
    if (!tickCallback) {
      // Do not start gameloop if no tick callback
      // is defined.
      
      return;
    }

    function gameloop() {
      var time = Date.now();
      var delta = (time - currentTime) / 1000;

      currentTime = time;

      if (delta > 0.25) {
        delta = 0.25;
      } 

      accumulator += delta;

      while (accumulator >= DELTA_TIME) {
        accumulator -= DELTA_TIME;

        movePaddles(DELTA_TIME);
        moveBall(DELTA_TIME);
        checkCollisions(DELTA_TIME);

      }

      // Redraw everything
      renderScene();
      
      tickCallback();
    }
    
    // Render scene 60 frames per sec
    gameloopId = setInterval(gameloop, 1000 / 60);
  }
  
});