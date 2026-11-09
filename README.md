<div align="left">
  <img src="docs/assets/logo.svg" alt="LEMS logo" width="150">
</div>

# Lab Equipment Management System (LEMS)

Lab Equipment Management System (LEMS) is a web-based information system designed to simplify laboratory equipment management and malfunction reporting.

The system allows students to view laboratory equipment, submit booking requests, track their bookings, and report equipment problems. Administrators can manage equipment, process booking requests, and handle reported malfunctions.

## Screenshots

<details>
<summary>Login Page</summary>

<div align="center">

<img src="docs/assets/login.png" alt="Login Page">

</div>

</details>

<details>
<summary>Student Registration</summary>

<div align="center">

<img src="docs/assets/student_registration.png" alt="Student Registration">

</div>

</details>

<details>
<summary>Dashboard</summary>

<div align="center">

<img src="docs/assets/dashboard.png" alt="Dashboard">

</div>

</details>

<details>
<summary>Equipment — Student View</summary>

<div align="center">

<img src="docs/assets/equipment_student.png" alt="Equipment page for students">

</div>

</details>

<details>
<summary>Equipment Booking</summary>

<div align="center">

<img src="docs/assets/equipment_booking.png" alt="Equipment booking form">

</div>

</details>

<details>
<summary>Student Bookings</summary>

<div align="center">

<img src="docs/assets/student_bookings.png" alt="Student bookings">

</div>

</details>

<details>
<summary>Report an Issue</summary>

<div align="center">

<img src="docs/assets/report_issue.png" alt="Report an equipment issue">

</div>

</details>

<details>
<summary>Student Repair Requests</summary>

<div align="center">

<img src="docs/assets/student_repair_requests.png" alt="Student repair requests">

</div>

</details>

<details>
<summary>Equipment Management — Admin</summary>

<div align="center">

<img src="docs/assets/equipment_admin.png" alt="Equipment management for administrators">

</div>

</details>

<details>
<summary>Update Equipment</summary>

<div align="center">

<img src="docs/assets/update_equipment.png" alt="Update equipment form">

</div>

</details>

<details>
<summary>Repair Requests — Admin</summary>

<div align="center">

<img src="docs/assets/admin_repair_requests.png" alt="Repair requests for administrators">

</div>

</details>

## BPMN

This diagram illustrates the LEMS business process ([PNG](docs/assets/bpmn.png), [SVG](docs/assets/bpmn.svg)).

## Usage

```bash
# Clone the repository
git clone https://github.com/Archi816/AIS_PU-project.git
cd AIS_PU-project

# Build and start the containers
docker-compose up --build -d

# Stop the containers
docker-compose down
```

> Make sure to create and configure the `.env` file before starting the containers.

Open [http://localhost:5000](http://localhost:5000) and sign in with a demo
account:

- Admin: `admin@lems.local` / `Admin123!`
- Student: `jan.novak@student.tuke.sk` / `Student123!`

## Architecture

![architecture](docs/assets/architecture.png)

## AI Service

The AI component helps generate a preliminary equipment failure report. It searches for relevant information in the catalog and documentation, then produces a structured response containing symptoms, possible causes, recommended inspection steps, and missing information.

Search is performed using semantic similarity with a local embedding model. Report generation can be configured to use either OpenRouter or Azure OpenAI. The response is returned in JSON format, including references to the source documentation whenever available.

## Authors

- **Dmytro Varich** ([Github](https://github.com/dmytro-varich), [Outlook](mailto:dmytro.varich@student.tuke.sk))
- **Daniil Sputai** ([Github](https://github.com/Sputaiok1925), [Outlook](mailto:daniil.sputai@student.tuke.sk))
- **Artem Polianetskyi** ([Github](https://github.com/Archi816), [Outlook](mailto:artem.polianetskyi@student.tuke.sk))
- **Myroslav Yatsenko** ([Github](https://github.com/Mirikkirim-dev), [Outlook](mailto:myroslav.yatsenko@student.tuke.sk))
