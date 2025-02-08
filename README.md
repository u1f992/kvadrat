# Kvadrat

Vectorizes bitmap images by converting each pixel into polygons and merging regions with the same color.

|         Input         |         Output         |
| :-------------------: | :--------------------: |
| ![](./test/input.png) | ![](./test/output.svg) |

The SVG conversion algorithm is based on [ygoe/qrcode-generator](https://github.com/ygoe/qrcode-generator/blob/985860d3e6c42b5d174132a4ecce4a8c0c88f88f/js/qrcode.js#L491-L668) (MIT License).

## Performance

```
> Get-CimInstance Win32_Processor

DeviceID Name                           Caption                               MaxClockSpeed SocketDesignation Manufacturer
-------- ----                           -------                               ------------- ----------------- ------------
CPU0     Intel(R) Core(TM) Ultra 7 155U Intel64 Family 6 Model 170 Stepping 4 1700          U3E1              GenuineIntel

> Measure-Command { node .\dist\cli.js --input .\test\input.png --output .\test\output.svg }

Days              : 0
Hours             : 0
Minutes           : 13
Seconds           : 16
Milliseconds      : 404
Ticks             : 7964048590
TotalDays         : 0.00921764883101852
TotalHours        : 0.221223571944444
TotalMinutes      : 13.2734143166667
TotalSeconds      : 796.404859
TotalMilliseconds : 796404.859
```
