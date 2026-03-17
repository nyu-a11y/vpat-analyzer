# VPAT Analyzer

A Google Apps Script tool for extracting, interpreting, and quality-checking
VPAT (Voluntary Product Accessibility Template) documents using AI.

---

## Overview

VPAT Analyzer automates the review of VPAT/ACR documents by:

1. Extracting conformance data from VPAT tables in Google Docs, DOCX, or PDF files
2. Interpreting conformance levels using an AI model of your choice
3. Running a configurable quality checklist against the document

Results are written back to a structured Google Sheet for review.

---

## Features

- Extracts conformance levels and remarks from VPAT document tables
- AI-powered interpretation of conformance data across accessibility mediums
  (Web, Electronic Docs, Software, Closed, Authoring Tool)
- Configurable quality checklist with per-requirement AI evaluation
- Supports multiple AI providers: OpenAI, Google Gemini, and NYU Portkey Gateway
- Batch processing with automatic retry and rate-limit handling
- All processing runs within the user's own Google Drive

---

## Prerequisites

- A Google account with access to Google Drive and Google Sheets
- An API key for at least one supported AI provider:
 
  - [Google Gemini](https://aistudio.google.com/)— recommended
  - [OpenAI](https://platform.openai.com/) 
---

## Getting Started

### Step 1: Copy the Google Sheet Template

Click the link below to copy the pre-configured template directly to your
Google Drive:

> **[Copy Template to My Drive](#)**
> *(Template link coming soon)*



### Step 2: Follow the Setup Instructions

Full setup instructions, including how to configure the use the template, connect your
VPAT document, and enter your API key, are available in the guide linked below:

> **[View Setup Instructions](#)**
> *(Documentation link coming soon)*

---

## Contributing and Feedback

This project is not currently open for code contributions, but feedback and
feature suggestions are welcome.

If you encounter a bug, have a question, or want to suggest a new feature,
please open an issue in this repository:

> **[Open an Issue on GitHub](https://github.com/nyu-a11y/vpat-analyzer/issues)**

When opening an issue, please include:

- A clear description of the problem or suggestion
- Steps to reproduce (if reporting a bug)
- The file format and AI provider you are using (if applicable)

---

## Disclaimer

**This tool uses artificial intelligence (AI) to interpret accessibility
conformance data. AI output may be inaccurate, incomplete, or misleading.
All results must be reviewed by a qualified accessibility professional before
being relied upon.**


By using this tool, you acknowledge that:

1. You have read and understood the code before running it.
2. You accept full responsibility for any consequences of its use.
3. You are responsible for complying with the terms of service of any
   AI provider whose API key you use.
4. No warranty, express or implied, is provided with this tool.
4. No Support, express or implied, is provided with this tool.
