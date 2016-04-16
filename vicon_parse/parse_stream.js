'use strict';

var osc = require('osc');

var cmd = "./ViconDataStreamSDK_CPPTest 169.254.215.174:801"

// Create an osc.js UDP Port listening on port 57121.
var udpPort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: 57121
});

// Open the socket.
udpPort.open();

// Send an OSC message to localhost:3333
// udpPort.send({
//     address: "/s_new",
//     args: ["default", 100]
// }, "127.0.0.1", 3333);

var spawn = require('child_process').spawn;
var stream = spawn('./ViconDataStreamSDK_CPPTest', ['169.254.215.174:801']);

var buffer = '';
var re = /Segment #\d\s+Name:\s(\w+)[^G]*Global Translation:\s\((.*)\)/;

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
        var position = matches[2].toString().split(', ');
        if (!tracking[name]) {
          tracking[name] = [];
        }
        tracking[name].push(position);
        while (tracking[name].length > 20) {
          tracking[name].shift();
        }
        console.log(tracking);
      }
    }
    else {
      break;
    }
    indexStart = buffer.indexOf('Subject');
    indexEnd = buffer.indexOf('Marker #0');
  }
});

var tracking = {};