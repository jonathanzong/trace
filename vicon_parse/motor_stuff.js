var SerialPort = require("serialport").SerialPort
var serialPort = new SerialPort("/dev/tty.RNBT-8A88-RNI-SPP", {
  baudrate: 9600
});

serialPort.on('open', function () {
  serialPort.write('180', function(err, bytesWritten) {
    if (err) {
      return console.log('Error: ', err.message);
    }
    console.log(bytesWritten, 'bytes written');
  });
});