var SerialPort = require("serialport").SerialPort
var motor = new SerialPort("/dev/tty.RNBT-8A88-RNI-SPP", {
  baudrate: 9600
});

motor.on('open', function () {
  console.log('open');
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  var util = require('util');

  process.stdin.on('data', function (text) {
    console.log('received data:', util.inspect(text));

    if (text === 'quit\n') {
      done();
    } else {

      motor.write(text, function(err, bytesWritten) {
        if (err) {
          return console.log('Error: ', err.message);
        }
        console.log(bytesWritten, 'bytes written');
      });
    }
  });

  function done() {
    motor.close(function (err) {
      console.log('port closed', err);
      process.exit();
    });
  }

  process.on('SIGINT', done);
});

function logger(arg) {
  console.log(arg);
}

motor.on('close', logger);
motor.on('error', logger);
motor.on('disconnect', logger);

