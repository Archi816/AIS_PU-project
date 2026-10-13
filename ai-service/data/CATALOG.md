# Demo equipment catalog

All model assignments, locations and operational states are fictional project assumptions, not verified TUKE inventory. Manufacturer sources are real. Each item is_demo=true. operational is a demo state, not proof of availability or a reservation. Summaries cover limited preliminary checks, not complete repair manuals.

| ID | Category | Model | Demo location | Demo condition |
|---|---|---|---|---|
| PC-001 | computer | Dell OptiPlex 7090 Micro | Demo Computing Lab | operational |
| LAP-001 | laptop | HP ProBook 450 G8 | Demo Equipment Loan Desk | operational |
| PRN-001 | 3d_printer | Creality Ender-3 | Demo Prototyping Lab | operational |
| ROB-001 | robot | TurtleBot3 Burger | Demo Robotics Lab | operational |
| ARD-001 | electronics | Arduino UNO R3 | Demo Electronics Lab | operational |
| RPI-001 | computer | Raspberry Pi 4 Model B | Demo Electronics Lab | operational |
| MUL-001 | measurement | Fluke 115 | Demo Electronics Lab | operational |

## PC-001 — Laboratory workstation

Source: [Hardware, Diagnostics, and Error Codes; support guide](https://www.dell.com/support/kbdoc/en-au/000186466/optiplex-7090-desktop-system-guide)
Reviewed: 2026-10-15

Scope: Dell OptiPlex 7090 family support guide, used for the proposed Micro configuration. Dell provides SupportAssist, diagnostic error references, LED/beep references and separate guides for display, boot, network and thermal problems. This summary does not contain the individual LED-code tables. Project triage policy: record whether power, startup self-test, boot or video is failing; note exact diagnostic messages and blink sequences without inventing their meaning. Inspect external monitor/power connections and record the OS and affected peripherals. Do not assume a CPU/RAM/SSD configuration or prescribe firmware updates, OS resets or opening the case.

## LAP-001 — Student laptop

Source: [HP PCs: hardware diagnostics; general HP guidance](https://support.hp.com/th-en/document/ish_2854458-2733239-16)
Reviewed: 2026-10-15

Scope: general HP PC hardware-diagnostics guidance, not a ProBook-specific repair manual. HP provides Windows and UEFI diagnostics; UEFI tests can be available independently of the installed OS. The diagnostic results can include a 24-digit failure ID. Record the test name, failure ID and product ID rather than interpreting an unverified code. Project triage policy: for this proposed ProBook 450 G8, record charging indicator, external adapter label, boot-screen messages and OS version as relevant. Review existing diagnostic results. Confirm diagnostics availability on this configuration before suggesting a test. Do not open the battery, change firmware or reset the operating system.

## PRN-001 — 3D printer

Source: [Extruder skipping: limited preliminary summary](https://store.creality.com/blogs/all/ender-3-extruder-skipping)
Reviewed: 2026-10-15

Scope: original Creality Ender-3; limited manufacturer article summary, not a full service manual. Extruder skipping can cause uneven filament delivery, gaps and incomplete prints. Poor extrusion can indicate a blockage but does not establish its cause. The article discusses moisture-related filament inconsistencies and dry storage. Project triage policy, not manufacturer repair instructions: record clicking, visible filament movement, spool condition, material type and existing temperature/error readings. This summary excludes heating, manual extrusion, disassembly and adjustment procedures.

## ROB-001 — Mobile robot

Source: [Bringup TurtleBot3: ROS 2 Humble/Jazzy; topic discovery](https://emanual.robotis.com/docs/en/platform/turtlebot3/bringup/)
Reviewed: 2026-10-15

Scope: TurtleBot3 Burger with ROS 2; confirm the ROS distribution. ROBOTIS specifies burger model selection. Remote PC and robot SBC need a shared network, matching ROS_DOMAIN_ID and ROS middleware implementation; multicast support affects discovery. Review existing bringup logs and observe published topics with ros2 topic list. Examples include /scan, /odom and /battery_state, but topics vary by package version. Jazzy uses TwistStamped for cmd_vel by default. Project triage policy: record ROS version, model selection, topic list and error output. An absent topic does not prove sensor failure. Do not automatically change network settings, start motion or flash firmware.

## ARD-001 — Arduino development kit

Source: [General troubleshooting checklist; Still need help](https://support.arduino.cc/hc/en-us/articles/4401874331410--Error-avrdude-when-uploading)
Reviewed: 2026-10-13

Reviewed summary for upload errors on Arduino UNO R3: Check that Arduino IDE has the matching board and serial port selected. Other IDE instances and serial-monitor applications may occupy the port. Verify the USB connection and use a cable that transfers data, not a charging-only cable. A direct computer USB connection can help isolate hub problems. Record the full upload error, board name, operating system, and IDE version for diagnosis. These checks concern upload failures, not every electronics fault.

## RPI-001 — Raspberry Pi kit

Source: [Getting started: power supply and operating system setup](https://www.raspberrypi.com/documentation/computers/getting-started.html)
Reviewed: 2026-10-15

Scope: Raspberry Pi 4 Model B, not Pi 5 or Zero. The official setup guide recommends a 5 V, 3 A supply for Pi 4 Model B and lists the 15 W USB-C supply. Setup involves an operating system image and configured login/network details. Project triage policy: record the power-supply label, connected USB peripherals, storage medium, OS version and observed boot/LED/display behaviour. Check external connections with power off when needed. For connection problems record the configured network and whether remote access was enabled. Do not assume a particular RAM capacity, decode unspecified LED patterns, or reimage storage without a backup and authorization.

## MUL-001 — Digital multimeter

Source: [Product overview and measurement functions](https://www.fluke.com/en/product/electrical-testing/digital-multimeters/fluke-115)
Reviewed: 2026-10-15

Scope: Fluke 115 product overview, not a complete repair or electrical-work procedure. The meter supports true-RMS voltage/current, resistance, continuity, frequency and capacitance measurements, and Min/Max/Average recording. Project triage policy: record the selected function, displayed value/unit, connected input sockets, battery indicator and visible condition of disconnected leads. An unexpected reading does not by itself establish meter failure. Remove visibly damaged equipment from use. Do not recommend opening the meter, replacing fuses, bypassing protection or testing live circuits from this summary; consult the complete model-specific manual and qualified personnel.
