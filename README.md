# VPAT Processor - Google Sheets Tool

A powerful Google Apps Script tool that automates VPAT (Voluntary Product Accessibility Template) data extraction and analysis using AI.

## 📋 What This Tool Does

This tool helps you:

1. **Extract VPAT Data** - Automatically pulls conformance levels and remarks from VPAT documents (Google Docs, DOCX, PDF) into a structured Google Sheet
2. **AI Interpretation** - Uses AI (OpenAI or Gemini) to interpret conformance data across different platforms (Web, Electronic Docs, Software, etc.)
3. **Quality Analysis** - Automatically evaluates VPAT documents against a configurable quality checklist

---

## 🚀 Quick Start

### 1. Get the Google Sheet

👉 **[Click here to duplicate the VPAT Processor Google Sheet](https://docs.google.com/spreadsheets/d/1oO_I52YKZcOyTUYgsqDGvNN9I8gQQ0gIYrTyF41CYB4/copy)**

Make a copy of the sheet to your Google Drive.

### 2. Set Up Your AI Provider

The sheet needs an API key to use AI features.

#### Option A: Use OpenAI (Recommended)
1. Go to [platform.openai.com](https://platform.openai.com)
2. Create an API key
3. In your Google Sheet, go to the **"AI Provider"** sheet
4. In cell **A2**, enter: `OpenAI`
5. In cell **B2**, paste your API key

#### Option B: Use Google Gemini
1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Create an API key
3. In your Google Sheet, go to the **"AI Provider"** sheet
4. In cell **A2**, enter: `Gemini`
5. In cell **B2**, paste your API key

### 3. Prepare Your Sheet Columns

Your main sheet should have these column headers (the template already has them):

**Required Columns:**
- `Criteria` - WCAG criteria numbers (e.g., 1.1.1, 1.2.1)
- `Conformance Level (original)` - Will be filled by extraction
- `Remarks and Explanations (original)` - Will be filled by extraction
- `Conformance Level (interpreted)` - Will be filled by AI
- `Web (interpreted)` - Will be filled by AI
- `Electronic Docs (interpreted)` - Will be filled by AI
- `Software (interpreted)` - Will be filled by AI
- `Closed (interpreted)` - Will be filled by AI
- `Authoring Tool (interpreted)` - Will be filled by AI
- `AI Comment` - AI explanations when confidence is low
- `Needs Review` - Checkbox flagged when AI confidence is low

---

## 📖 How to Use

### Basic Workflow: Extract + Interpret

1. **Prepare your VPAT document**
   - Upload your VPAT to Google Drive (supports Google Docs, DOCX, or PDF)
   - Get the File ID from the URL:
     ```
     https://docs.google.com/document/d/FILE_ID_HERE/edit
     ```

2. **Run Extraction**
   - In your Google Sheet, click **VPAT Processor → 1. Extract from Document**
   - Enter the File ID
   - Enter row range (e.g., `2, 50`) or leave empty to process all rows
   - Wait for extraction to complete

3. **Run AI Interpretation**
   - Click **VPAT Processor → 2. Interpret with AI**
   - Enter row range or leave empty for all rows
   - AI will analyze each row and fill interpreted columns

4. **Review Results**
   - Check rows where `Needs Review` is checked
   - Read `AI Comment` for low-confidence interpretations
   - Manually adjust any incorrect interpretations

### Advanced: Quality Checklist Analysis

Run comprehensive quality checks on your VPAT document:

1. **Set Up Quality Requirements** (one-time setup)
   - Go to the **"Quality Requirements"** sheet
   - The template includes example questions
   - Customize or add your own quality requirements

2. **Run Quality Analysis**
   - Click **VPAT Processor → 3. Quality Checklist Analysis**
   - Enter the File ID of your VPAT document
   - Wait for AI to analyze and answer all questions
   - Review the **AI Response**, **Original from VPAT**, and **AI Explanation** columns

### All-in-One: Run Full Processing

Click **VPAT Processor → Run All (Extract + Interpret + Quality)** to run all three steps automatically.

---

## 🔧 Configuration

### Prompts Sheet

The **Prompts** sheet contains AI instructions. You can customize the AI's behavior:

| Prompt Name                   | Purpose                                    | Customizable |
| ----------------------------- | ------------------------------------------ | ------------ |
| `INTERPRET_CONFORMANCE`       | How AI interprets conformance levels       | Yes          |
| `CONFIDENCE_LEVEL`            | Threshold for flagging reviews (0-100)     | Yes          |
| `QUALITY_CHECKLIST_ANALYSIS`  | How AI answers quality checklist questions | Yes          |

**To adjust the review confidence threshold:**
- In the **Prompts** sheet, find the row with `CONFIDENCE_LEVEL`
- Change the value in column B (default: 70)
- Lower values = fewer reviews needed, higher values = more thorough review

### AI Provider Sheet

Configure which AI service to use:

| Cell | Value                  |
| ---- | ---------------------- |
| A2   | `OpenAI` or `Gemini`   |
| B2   | Your API key           |

### Quality Requirements Sheet

Customize what quality checks are performed:

- **Add new questions** - Add rows with your own quality requirements
- **Group questions** - Use the same `Criteria` number to group related questions
- **Response Types** - Specify `Date`, `Yes/No`, or `Short Text` to control answer format
- **AI Guidelines** - Provide hints to help AI find answers (optional)

---

## 📊 Understanding the Results

### Interpreted Columns

After AI interpretation, you'll see:

- **Conformance Level (interpreted)** - Overall conformance across all platforms
- **Platform-specific columns** - Individual conformance for Web, Docs, Software, etc.
- **AI Comment** - Explanations appear when confidence is below threshold
- **Needs Review** - Checkbox is marked when manual review is recommended

### Valid Conformance Values

All interpreted columns use these standardized values:
- `Supports`
- `Partially Supports`
- `Does Not Support`
- `Not Applicable`
- `Not Evaluated`

### Quality Analysis Columns

After quality analysis:
- **AI Response** - Direct answer based on Response Type
- **Original from VPAT** - Exact quote from the document supporting the answer
- **AI Explanation** - AI's reasoning and confidence level

---

## 🔍 Troubleshooting

### "Required column not found"
- Check that your sheet has all required column headers with exact spelling
- Column names are case-sensitive

### "Failed to load document"
- Verify the File ID is correct
- Make sure the file is accessible in your Google Drive
- For PDFs, OCR conversion may take 30+ seconds

### "API key not found"
- Check the **AI Provider** sheet has your API key in cell B2
- Ensure there are no extra spaces in the API key

### "Invalid response structure"
- The AI returned unexpected data
- Try running the script again
- Check your API key is valid and has credits

### Extraction matched 0 rows
- Verify your sheet's `Criteria` column has values like "1.1.1", "1.2.1", etc.
- Check that your VPAT document has tables with criteria numbers

---

## ⚙️ Advanced Configuration

### Batch Processing Settings

Edit [VPATProcessor.js](App%20Script%20with%20Sheet/VPATProcessor.js) to adjust:

```javascript
const CONFIG = {
  // AI batch size (rows per API call)
  BATCH_SIZE: 5,  // 0 = process all at once
  
  // Delay between API calls (milliseconds)
  API_DELAY_MS: 1000,
  
  // Quality checklist batch size (questions per call)
  QUALITY_CHECKLIST: {
    REQUIREMENTS_BATCH_SIZE: 5,  // Recommended: 5-10
  }
};
```
