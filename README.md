# ⚡ Rend Autofill

### Less form filling. More job applying.

**Rend Autofill** is a privacy-first Chrome extension built to make repetitive job applications faster and less painful.

It detects supported Applicant Tracking Systems (ATS), fills application forms from your saved profile, chooses the most relevant resume for the job, and extracts clean job context when you need it.

**You stay in control. Rend never submits an application for you.**

---

## ✨ What Rend Does

### ⚡ Smart Autofill

Fill repetitive application fields using your locally saved candidate profile.

Rend can handle common information such as:

- Name and contact information
- Location
- Professional links
- Employment information
- Resume uploads
- Common application fields

The goal is simple:

> Spend less time typing the same information into every application.

---

### 🎯 Automatic Resume Selection

Have multiple resumes for different roles?

Rend can compare the current job context against your saved resume metadata and automatically select the most relevant resume.

For example:

- Backend Engineer
- Platform Engineer
- DevOps / SRE
- Cloud Engineer
- Software Engineer

Resume selection is deterministic and explainable rather than silently choosing a file at random.

You can always override the selection manually.

---

### 🧠 ATS-Aware Autofill

Rend recognizes job application platforms and can use platform-specific handling instead of treating every website as the same generic form.

Current development includes dedicated support for:

- **Greenhouse**
- **Ashby**

Additional ATS integrations are being developed and tested progressively.

---

### 📋 Copy Job Brief

One click turns a job posting into clean, structured context:

```text
JOB
Title: Senior Backend Engineer
Company: Example Company
Location: Remote
Platform: Greenhouse

SELECTED RESUME
Name: Backend Engineer Resume
Selection: Automatic

JOB POSTING
...
