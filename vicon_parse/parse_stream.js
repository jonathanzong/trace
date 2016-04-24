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

var LMA = {
  effort: {
    space: 0.5, // [indirect, direct]
    weight: 0.5, // [light, strong]
    time: 0.5, // [sustained, sudden]
    flow: 0.5 // [free, bound]
  }, // in [0, 1]
  shape: {
    x: 0.5, // horizontal [enclosing, spreading]
    y: 0.5, // vertical [sinking, rising]
    z: 0.5 // sagittal [retreating, advancing]
  }, // in [0, 1]
  space: {
    reach: 0.5 // near/mid/far in [0, 1]
  }
}

var minLMA = {
  effort: {
    space: 9999999999, // [indirect, direct]
    weight: 9999999999, // [light, strong]
    time: 9999999999, // [sustained, sudden]
    flow: 9999999999 // [free, bound]
  }, // in [0, 1]
  shape: {
    x: 9999999999, // horizontal [enclosing, spreading]
    y: 9999999999, // vertical [sinking, rising]
    z: 9999999999 // sagittal [retreating, advancing]
  }, // in [0, 1]
  space: {
    reach: 9999999999 // near/mid/far in [0, 1]
  }
}

var maxLMA = {
  effort: {
    space: -99999999, // [indirect, direct]
    weight: -99999999, // [light, strong]
    time: -99999999, // [sustained, sudden]
    flow: -99999999 // [free, bound]
  }, // in [0, 1]
  shape: {
    x: -99999999, // horizontal [enclosing, spreading]
    y: -99999999, // vertical [sinking, rising]
    z: -99999999 // sagittal [retreating, advancing]
  }, // in [0, 1]
  space: {
    reach: -99999999 // near/mid/far in [0, 1]
  }
}

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

// TODO refactor this like wow seriously
function updateLMA() {

  var njoints = Object.keys(velocities).length;
  if (njoints !== 9) return;

  // LMA.effort.space
  // velocity cosines
  var vcosines = 0;
  for (var joint in velocities) {
    if (!velocities.hasOwnProperty(joint)) continue;
    var samples = velocities[joint];
    if (samples.length >= 2) {
      var jcosines = [];
      for (var i = 0; i < samples.length - 1; i++) {
        var cosine = dot(copy(samples[i]), samples[i + 1]) / (mag(samples[i]) * mag(samples[i + 1]));
        if (cosine)
          jcosines.push((cosine + 1) / 2);
      }
      var jcosine = avg(jcosines);
      vcosines += jcosine;
    }
  }
  vcosines /= njoints;
  LMA.effort.space = vcosines;

  // LMA.effort.weight
  // accelerations
  var avgAcc = 0;
  for (var joint in accelerations) {
    if (!accelerations.hasOwnProperty(joint)) continue;
    var samples = accelerations[joint];
    avgAcc += mag(avgVecs(samples));
  }
  avgAcc /= njoints;
  LMA.effort.weight = avgAcc / 10; //TODO magic empirical number

  // LMA.effort.time
  // acceleration skew (seems related to jerk?)
  var accSkewDiffs = 0;
  var minDiff = 0;
  for (var joint in accelerations) {
    if (!accelerations.hasOwnProperty(joint)) continue;
    var samples = accelerations[joint];
    var oldHalf = 0;
    var newHalf = 0;
    var halfway = Math.floor(samples.length / 2);
    for (var i = 0; i < halfway; i++) {
      oldHalf += mag(samples[i]);
      newHalf += mag(samples[i + halfway]);
    }
    oldHalf /= halfway;
    newHalf /= halfway;
    var skewDiff = oldHalf - newHalf;
    if (minDiff > skewDiff)
      minDiff = skewDiff;
    accSkewDiffs += skewDiff;
  }
  accSkewDiffs /= njoints;
  accSkewDiffs -= minDiff; // make positive
  LMA.effort.time = Math.sqrt(accSkewDiffs); //TODO lol magic i'm literally guessing

  // LMA.effort.flow
  // velocities
  var avgVels = 0;
  for (var joint in velocities) {
    if (!velocities.hasOwnProperty(joint)) continue;
    var samples = velocities[joint];
    avgVels += mag(avgVecs(samples));
  }
  avgVels /= njoints;
  LMA.effort.flow = 1 - (avgVels / 20); // TODO magic number

  // LMA.shape.x, y, z
  // spread
  var head = avgVecs(positions['2_head']);
  var leftShoulder = avgVecs(positions['2_left_shoulder']);
  var rightShoulder = avgVecs(positions['2_right_shoulder']);
  var horizontal = sub(copy(rightShoulder), leftShoulder);
  var mh = mag(horizontal);
  var avghdist = 0;
  var l2h = sub(copy(head), leftShoulder);
  var r2h = sub(copy(head), rightShoulder);
  var vertical = add(copy(l2h), r2h);
  var mv = mag(vertical);
  var avgvdist = 0;
  var sagittal = cross(l2h, r2h);
  var ms = mag(sagittal);
  var avgsdist = 0;
  for (var joint in positions) {
    if (!positions.hasOwnProperty(joint)) continue;
    var samples = positions[joint];
    var diff = sub(avgVecs(samples), head);
    avghdist += Math.abs(dot(diff, horizontal)) / mh;
    avgvdist += Math.abs(dot(diff, vertical)) / mv;
    avgsdist += Math.abs(dot(diff, sagittal)) / ms;
  }
  avghdist /= njoints;
  avgsdist /= njoints;
  avgvdist /= njoints;
  LMA.shape.x = avghdist / (AVG_HEIGHT / 2);
  LMA.shape.y = avgsdist / (AVG_HEIGHT / 2);
  LMA.shape.z = avgvdist / (AVG_HEIGHT * 2 / 3);

  // LMA.space.reach
  var maxDist = 0;
  for (var joint1 in positions) {
    if (!positions.hasOwnProperty(joint1)) continue;
    var avg1 = avgVecs(positions[joint1]);
    for (var joint2 in positions) {
      if (!positions.hasOwnProperty(joint2)) continue;
      if (joint2 == joint1) continue;
      var avg2 = avgVecs(positions[joint2]);
      var dist = mag(sub(copy(avg1), avg2));
      if (dist > maxDist)
        maxDist = dist;
    }
  }
  LMA.space.reach = maxDist / AVG_HEIGHT;
  
  for (var i in LMA) {
    for (var j in LMA[i]) {
      // Send an OSC message to localhost:3333
      if (LMA[i][j]) {
        LMA[i][j] = clamp(LMA[i][j]); // clamp to [0, 1]
        //
        // if (LMA[i][j] < minLMA[i][j]) {
        //   minLMA[i][j] = LMA[i][j];
        // }
        // else if (LMA[i][j] > maxLMA[i][j]) {
        //   maxLMA[i][j] = LMA[i][j];
        // }
        // console.log(JSON.stringify(minLMA, null, 2));
        // console.log(JSON.stringify(maxLMA, null, 2));
        //
        var payload = {
          address: "/LMA/" + i + "/" + j,
          args: LMA[i][j]
        };
        console.log(JSON.stringify(payload));
        udpPort.send(payload, "127.0.0.1", 3333);
      }
    }
  }
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

  updateLMA();
});

console.log('hello');