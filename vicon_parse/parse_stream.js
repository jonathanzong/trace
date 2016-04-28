'use strict';

var osc = require('osc');

// Create an osc.js UDP Port listening on port 57121.
var udpPort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: 57121
});

// Open the socket.
udpPort.open();

var spawn = require('child_process').spawn;
var stream = spawn('./ViconDataStreamSDK_CPPTest', ['169.254.215.174:801']);

var SAMPLE_SIZE = 20;

var AVG_HEIGHT = 1700; // 5ft 6in, converted to mm

var positions = {};
var velocities = {};
var accelerations = {};

// param: name (string), positon (array3)
function updateTracking(name, position) {
  // initialize
  if (!positions[name]) {
    positions[name] = [];
  }
  if (!velocities[name]) {
    velocities[name] = [];
  }
  if (!accelerations[name]) {
    accelerations[name] = [];
  }
  var pn = positions[name];
  var vn = velocities[name];
  var an = accelerations[name];
  // update
  pn.push(position);
  if (pn.length >= 2) {
    vn.push(sub(copy(pn[pn.length - 1]), pn[pn.length - 2]));
  }
  if (vn.length >= 2) {
    an.push(sub(copy(vn[vn.length - 1]), vn[vn.length - 2]));
  }
  // delete oldest
  while (pn.length > SAMPLE_SIZE) {
    pn.shift();
  }
  while (vn.length > SAMPLE_SIZE) {
    vn.shift();
  }
  while (an.length > SAMPLE_SIZE) {
    an.shift();
  }
}

//

var dot = require('vectors/dot')(3);
var add = require('vectors/add')(3);
var sub = require('vectors/sub')(3);
var div = require('vectors/div')(3);
var copy = require('vectors/copy')(3);
var vmag = require('vectors/mag')(3);
var mag = function(v) {return Math.abs(vmag(v));}
var cross = require('vectors/cross')(3);

function avgVecs(vecs) {
  if (vecs && vecs.length) {
    var sum = [0, 0, 0];
    for (var i = 0; i < vecs.length; i++) {
      add(sum, vecs[i]);
    }
    div(sum, vecs.length);
    return sum;
  }
  return vecs;
}

function avg(arr) {
  if (arr.length) {
    var sum = 0;
    for (var i = 0; i < arr.length; i++) {
      sum += arr[i];
    }
    sum /= arr.length;
    return sum;
  }
  return 0;
}

function clamp(i) {
  if (i < 0) return 0;
  if (i > 1) return 1;
  return i;
}

var analysis = {};

var noise = require('./noise.js');

function updateAnalysis() {
  var njoints = Object.keys(positions).length;
  if (njoints !== 9) return;
  // reach
  var maxDist = 0;
  for (var joint1 in positions) {
    if (!positions.hasOwnProperty(joint1)) continue;
    var avg1 = avgVecs(positions[joint1]);
    for (var joint2 in positions) {
      if (!positions.hasOwnProperty(joint2)) continue;
      if (joint2 == joint1) continue;
      var avg2 = avgVecs(positions[joint2]);
      var dist = Math.abs(mag(sub(copy(avg1), avg2)));
      if (dist > maxDist)
        maxDist = dist;
    }
  }
  analysis.reach = maxDist / 2 / AVG_HEIGHT;

  // velocity
  var avgVel = 0;
  for (var joint in velocities) {
    if (!velocities.hasOwnProperty(joint)) continue;
    var avg = avgVecs(velocities[joint]);
    avgVel += mag(avg);
  }
  avgVel /= njoints;
  analysis.velocity = avgVel / 100;

  // height
  var maxZ = 0;
  for (var joint in positions) {
    if (!positions.hasOwnProperty(joint)) continue;
    var avg = avgVecs(positions[joint]);
    if (avg[2] > maxZ) {
      maxZ = avg[2];
    }
  }
  analysis.height = maxZ / 2 / AVG_HEIGHT;

  // // spread
  // var head = avgVecs(positions['2_head']);
  // var leftShoulder = avgVecs(positions['2_left_shoulder']);
  // var rightShoulder = avgVecs(positions['2_right_shoulder']);
  // var horizontal = sub(copy(rightShoulder), leftShoulder);
  // var mh = mag(horizontal);
  // var avghdist = 0;
  // var l2h = sub(copy(head), leftShoulder);
  // var r2h = sub(copy(head), rightShoulder);
  // var sagittal = cross(l2h, r2h);
  // var ms = mag(sagittal);
  // var avgsdist = 0;
  // for (var joint in positions) {
  //   if (!positions.hasOwnProperty(joint)) continue;
  //   var samples = positions[joint];
  //   var diff = sub(avgVecs(samples), head);
  //   avghdist += Math.abs(dot(diff, horizontal)) / mh;
  //   avgsdist += Math.abs(dot(diff, sagittal)) / ms;
  // }
  // avghdist /= njoints;
  // avgsdist /= njoints;
  // analysis.horizontal = avghdist / AVG_HEIGHT;
  // analysis.sagittal = avgsdist / AVG_HEIGHT;

  for (var k in analysis) {
    if (!analysis.hasOwnProperty(k)) continue;
    analysis[k] = clamp(analysis[k]);
  }

  updateRobotState();
}

var robotState = {};

var p = 0;
var pstep = 0.0001;
var MAX_SPEED = 250; // mm/s
//
function updateRobotState() {
  // update depth using analysis.height
  robotState.d = analysis.height;

  // update rotational speed with noise based on analysis.reach
  robotState.w = 2 * (noise((1 + analysis.reach) * pstep * p++) - 0.5);

  // update velocity magnitude with analysis.velocity
  robotState.v = MAX_SPEED * analysis.velocity;
}

var buffer = '';
var re = /Segment #\d\s+Name:\s(\w+)[^G]*Global Translation:\s\((.*)\)/;

// magic spaghetti
stream.stdout.on('data', function(data) {
  buffer += data.toString();
  var indexStart = buffer.indexOf('Subject');
  var indexEnd = buffer.indexOf('Marker #0', indexStart);
  while (indexStart >= 0 && indexEnd > indexStart) {
    var subjects = buffer.split('Subject');
    if (subjects.length > 1) {
      while (subjects.length && subjects[0].indexOf('Marker #0') < 0) subjects.shift();
      if (subjects.length) {
        var subject = subjects.shift();
        buffer = subjects.join('Subject'); // put the partial back into the buffer
        var matches = subject.match(re);
        var name = matches[1].toString().trim();
        if (name.indexOf("2_") !== 0) continue;
        var position = matches[2].toString().split(', ').map(function(d) {return parseInt(d);});
        updateTracking(name, position);
      }
    }
    else {
      break;
    }
    indexStart = buffer.indexOf('Subject');
    indexEnd = buffer.indexOf('Marker #0');
  }

  updateAnalysis();
});

///////////////////////////////////////////////////////////////////////
console.log('hello');

// robot stuff
var robot = require("create-oi");

robot.init({ serialport: "/dev/tty.AdafruitEZ-Link6a25-SPP", version: 2});

// motor stuff
var SerialPort = require("serialport").SerialPort
var motor = new SerialPort("/dev/tty.RNBT-8A88-RNI-SPP", {
  baudrate: 9600
});

// handlers
motor.on('open', function () {
  console.log('motor ready');
  robot.on('ready', function() {
    console.log('robot ready');
    var r = this;

    //cleanup
    process.stdin.resume(); //so the program will not close instantly

    function exitHandler(options, err) {
      motor.close(function (err) {
        if (err) {
          console.log(err);
        }
        console.log('motor port closed');
        process.exit();
      });
      if (err) {
        console.log(err.stack);
        process.exit();
      }
    }

    //catches ctrl+c event
    process.on('SIGINT', exitHandler.bind(null, {exit:true}));

    //catches uncaught exceptions
    process.on('uncaughtException', exitHandler.bind(null, {exit:true}));

    // event loop
    setInterval(function() {
      // robot instructions
      var radius = robotState.w == 0 ? 0 : robotState.v / robotState.w;
      r.drive(robotState.v, radius);
      console.log('robot update fired');
      console.log(JSON.stringify(robotState, null, 2));
      console.log(radius);
      // motor instructions
      var motorPos = (robotState.d * 25) + 25;
      motor.write(motorPos, function(err, bytesWritten) {
        if (err) {
          return console.log('Error: ', err.message);
        }
        console.log(bytesWritten, 'bytes written to motor');
      });
    }, 1000);
  });

});

motor.on('close', console.log);
motor.on('error', console.log);
motor.on('disconnect', console.log);

var bumpHndlr = function(bumperEvt) {
    var r = this;
    
    // temporarily disable further bump events
    // getting multiple bump events while one is in progress
    // will cause weird interleaving of our robot behavior 
    r.off('bump');

    // backup a bit
    r.drive(-MAX_SPEED, 0);
    r.wait(1000);

    // turn based on which bumper sensor got hit
    switch(bumperEvt.which) {
        case 'forward': // randomly choose a direction
            var dir = [-1,1][Math.round(Math.random())];
            r.rotate(dir*MAX_SPEED);
            r.wait(2100); // time is in ms
            break;
        case 'left':
            r.rotate(-MAX_SPEED); // turn right
            r.wait(1000);
            break;
        case 'right':
            r.rotate(MAX_SPEED); // turn left 
            r.wait(1000);
            break;
    }

    // onward!
    r.drive(MAX_SPEED, 0)
    .then(function() {
        // turn handler back on
        r.on('bump', bumpHndlr);
    });
};

robot.on('bump', bumpHndlr);
