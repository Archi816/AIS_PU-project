# Demo equipment catalog

Models, locations and operational states are fictional project assumptions, not verified TUKE inventory. All rows are demo data. These are selected paraphrased diagnostic topics, not complete manuals. Project policy is labelled separately. HP uses general guidance; Fluke remains a product overview.

| ID | Model | Demo location |
|---|---|---|
| PC-001 | Dell OptiPlex 7090 Micro | Demo Computing Lab |
| LAP-001 | HP ProBook 450 G8 | Demo Equipment Loan Desk |
| PRN-001 | Creality Ender-3 | Demo Prototyping Lab |
| ROB-001 | TurtleBot3 Burger | Demo Robotics Lab |
| ARD-001 | Arduino UNO R3 | Demo Electronics Lab |
| RPI-001 | Raspberry Pi 4 Model B | Demo Electronics Lab |
| MUL-001 | Fluke 115 | Demo Electronics Lab |

## PC-001 — Laboratory workstation

Source: [Selected diagnostic topics; manufacturer summary and labelled project policy](https://www.dell.com/support/kbdoc/en-au/000186466/optiplex-7090-desktop-system-guide)
Reviewed: 2026-10-27

Startup and display symptoms — proposed OptiPlex 7090 Micro
Dell's OptiPlex 7090 family support guide separates startup, display and other troubleshooting topics. Project policy: distinguish no power, failure during startup self-test, failure to boot the OS, and a blank display. Record the power indicator and screen behaviour before attributing the issue to a component.

Diagnostic indicators and errors — proposed OptiPlex 7090 Micro
The guide links diagnostic tests, error references and LED/beep information. Project policy: preserve the exact error and blink sequence. This summary contains no code-to-component lookup table; do not invent a decoded meaning. Review existing diagnostic results and confirm the exact Micro model before using another form factor's instructions.

Overheating or device-specific issues — proposed OptiPlex 7090 Micro
Dell links separate thermal, storage and peripheral troubleshooting guidance. Project policy: record the workload, existing logs, OS and external connections relevant to the symptom. Do not infer CPU/RAM configuration, replace internal parts or perform firmware changes from this overview.

## LAP-001 — Student laptop

Source: [Selected diagnostic topics; manufacturer summary and labelled project policy](https://support.hp.com/us-en/help/hp-pc-hardware-diagnostics)
Reviewed: 2026-10-27

Diagnostics in Windows — proposed HP ProBook 450 G8
General HP guidance describes HP PC Hardware Diagnostics Windows for checking hardware while Windows runs. Project policy: record the affected component and existing diagnostic result; confirm which tool is installed. This source is not a ProBook-specific service manual.

Windows cannot start / UEFI diagnostics — proposed HP ProBook 450 G8
HP also provides UEFI diagnostics outside the operating system to help distinguish hardware issues from software issues. Project policy: note whether the laptop powers on and whether the diagnostic environment is accessible. Do not claim that an inaccessible Windows desktop proves a hardware defect.

Failure identification — proposed HP ProBook 450 G8
HP asks for the diagnostic 24-digit failure ID and product number when arranging repair. Project policy: record these alongside the test name rather than inventing the meaning of the code. Review charging indicators and external adapter details if relevant; do not open the battery or reset Windows from this preliminary report.

## PRN-001 — 3D printer

Source: [Selected diagnostic topics; manufacturer summary and labelled project policy](https://store.creality.com/blogs/all/ender-3-extruder-skipping)
Reviewed: 2026-10-27

Clicking and uneven extrusion — original Ender-3
Creality describes extruder skipping as inconsistent filament feeding, with clicking or jumping movement, gaps and incomplete layers. Residue blocking the nozzle is one possible cause. Project policy: record the sound and visible feed behaviour; missing extrusion alone does not prove a nozzle clog.

Filament slipping or deformed feed — original Ender-3
Too much extruder tension can deform filament; too little may allow slipping. Project policy: record visible slipping and any recent changes for technician review. This preliminary report must not prescribe tension adjustment, disassembly or heating tests.

Filament quality and moisture — original Ender-3
Inconsistent filament diameter, contamination and absorbed moisture can affect feeding and print quality. Project policy: record filament type, storage conditions, spool path and existing temperature/error readings. Do not invent temperature settings or assume that these extrusion symptoms explain unrelated power failures.

## ROB-001 — Mobile robot

Source: [Selected diagnostic topics; manufacturer summary and labelled project policy](https://emanual.robotis.com/docs/en/platform/turtlebot3/bringup/)
Reviewed: 2026-10-27

Missing topics / ROS 2 discovery — TurtleBot3 Burger
ROBOTIS requires the remote PC and robot SBC to share a network environment, ROS_DOMAIN_ID and ROS middleware implementation. Multicast support affects discovery. Project policy: compare existing settings and network observations; do not automatically rewrite network configuration.

Missing scan or odometry / bringup — TurtleBot3 Burger
Review bringup output and inspect ros2 topic list. Published examples include /scan, /odom and /battery_state; available topics depend on software versions. Record the ROS distribution and burger model selection. Project policy: a missing scan topic alone is not evidence that the lidar hardware is broken.

Command type mismatch — TurtleBot3 Burger, ROS 2 Jazzy
The Jazzy instructions use TwistStamped for cmd_vel by default. Project policy: record the installed distribution and observed publisher/subscriber types before suggesting a compatibility issue. This report does not command robot motion, modify topics or flash firmware.

## ARD-001 — Arduino development kit

Source: [Selected diagnostic topics; manufacturer summary and labelled project policy](https://support.arduino.cc/hc/en-us/articles/4401874331410--Error-avrdude-when-uploading)
Reviewed: 2026-10-27

Upload handshake / programmer not responding — Arduino UNO R3
For stk500 upload failures, verify the board choice and serial port in Arduino IDE. A charging-only USB cable cannot transfer the sketch. A direct USB connection helps isolate hub issues. These checks do not establish a damaged bootloader. Record the complete avrdude error, OS and IDE version.

Missing serial device / no such file — Arduino UNO R3
The selected port may disappear when the board is disconnected or assigned another port. Compare the current Tools > Port selection with the connected board. Project policy: observe device enumeration before changing configuration. Do not apply classic Nano processor-selection advice to UNO R3.

Port busy / access denied — Arduino UNO R3
Another IDE instance, serial monitor or terminal can occupy the serial port. Check the selected port and close the competing application. Project policy: record the application and exact error; do not change system permissions indiscriminately. This material covers USB uploads, not all electronic faults.

## RPI-001 — Raspberry Pi kit

Source: [Selected diagnostic topics; manufacturer summary and labelled project policy](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html)
Reviewed: 2026-10-27

Undervoltage / unexpected restarts — Raspberry Pi 4 Model B
Official hardware documentation describes low-voltage warnings in the kernel log. Poor supplies and cables can cause unpredictable behaviour or storage corruption. Project policy: record the exact warning, external supply label, cable and attached USB devices. An unexpected restart alone does not prove undervoltage; review existing logs first.

Slow performance / thermal throttling — Raspberry Pi 4 Model B
Raspberry Pi reduces operating frequencies near its thermal limits. Project policy: record existing temperature readings, workload and cooling arrangement when investigating slowdown. Do not disable thermal protection or prescribe overclocking; distinguish recorded overheating from a guess.

Storage and startup observations — Raspberry Pi 4 Model B
Classic Raspberry Pi boards normally use removable microSD storage for the operating system and user data. Project policy: record storage type, OS version, exact boot display and LED pattern. Do not decode unverified blink codes or reimage storage without a backup and authorization. This is selected hardware guidance, not a complete boot-error manual.

## MUL-001 — Digital multimeter

Source: [Selected diagnostic topics; manufacturer summary and labelled project policy](https://www.fluke.com/en/product/electrical-testing/digital-multimeters/fluke-115)
Reviewed: 2026-10-27

Unexpected readings / measurement mode — Fluke 115
The manufacturer's product overview lists true-RMS voltage/current, resistance, continuity, frequency and capacitance functions. Project policy: record the selected function, displayed unit and input sockets before suggesting meter failure. This source does not provide a diagnostic error-code table or a live-circuit test procedure.

Fluctuating readings / recording — Fluke 115
The meter includes Min/Max/Average recording. Project policy: record whether a displayed value is a recorded minimum, maximum or average, and preserve the observed value. Do not interpret every fluctuation as a defective instrument or prescribe new energized measurements.

Blank display / visible damage — Fluke 115
Project triage policy, not a manufacturer repair procedure: record display and battery-indicator observations and inspect disconnected leads externally. Remove visibly damaged equipment from use. Consult the model manual and qualified personnel for repair; this product overview does not justify fuse replacement, opening the meter or bypassing protection.
