import { GoogleGenAI, Type } from "@google/genai";
import { ComplianceData, MasterData, Signatory, Charge, Financials, TabType } from "../types";
import { withRetry } from "../utils/retry";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeDocument(text: string, type: TabType, customType?: string): Promise<any> {
  const model = "gemini-3-flash-preview";
  
  const prompts = {
    master: "Extract Company Master Data: Company Name, CIN, Registration Date, Authorized Capital, Paid-up Capital, Registered Address, Company Status (e.g., ACTIVE, Struck Off), Date of last AGM, Date of Balance Sheet, and ACTIVE compliance status. Also extract the 'Index of Charges' table if present, including Charge ID, Amount, Holder Name, Date of Creation, Date of Modification, and Date of Satisfaction.",
    signatories: "Extract Signatory Details: List of Directors with DIN, Name, Designation (e.g., Deputy Managing Director), Appointment Date, Remuneration/Salary Scale, and any Disqualification Status.",
    charges: "Extract ALL Charge details from this CHG-1 / CHG form. Extract ALL fields: Charge ID, Date of Creation, Date of Modification (if any), Name of Charge Holder (Bank/Institution), Amount Secured (numerals and words), Nature/Type of Charge, Property Description (full details), Terms & Conditions, Margin, Repayment Terms, and Extent and Operation of Charge. Do NOT summarize or compress legal descriptions.",
    financials: "Extract Financials (AOC-4/MGT-7): Compliance Status, Industry Code, Last AGM Date, Last Balance Sheet Date.",
    other: `Extract key information from this document titled "${customType}". Focus on legal and financial implications, specifically looking for hidden details like interest rates, repayment terms, or director remuneration if applicable.`
  };

  const schemas = {
    master: {
      type: Type.OBJECT,
      properties: {
        companyName: { type: Type.STRING },
        cin: { type: Type.STRING },
        registrationDate: { type: Type.STRING },
        authorizedCapital: { type: Type.STRING },
        authorizedCapitalWords: { type: Type.STRING },
        authorizedCapitalShares: { type: Type.STRING },
        paidUpCapital: { type: Type.STRING },
        paidUpCapitalWords: { type: Type.STRING },
        paidUpCapitalShares: { type: Type.STRING },
        faceValue: { type: Type.STRING },
        registeredAddress: { type: Type.STRING },
        companyStatus: { type: Type.STRING },
        age: { type: Type.STRING },
        companyClass: { type: Type.STRING },
        companyCategory: { type: Type.STRING },
        companySubCategory: { type: Type.STRING },
        emailId: { type: Type.STRING },
        lastAgmDate: { type: Type.STRING },
        lastBalanceSheetDate: { type: Type.STRING },
        activeCompliance: { type: Type.STRING },
        indexOfCharges: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              chargeId: { type: Type.STRING },
              amount: { type: Type.STRING },
              holderName: { type: Type.STRING },
              dateOfCreation: { type: Type.STRING },
              dateOfModification: { type: Type.STRING },
              dateOfSatisfaction: { type: Type.STRING },
            }
          }
        }
      },
      required: ["companyName", "cin"]
    },
    signatories: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          din: { type: Type.STRING },
          name: { type: Type.STRING },
          designation: { type: Type.STRING },
          appointmentDate: { type: Type.STRING },
          remuneration: { type: Type.STRING },
          disqualificationStatus: { type: Type.STRING },
          totalDirectorships: { type: Type.STRING },
          otherDirectorships: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                companyName: { type: Type.STRING },
                status: { type: Type.STRING },
                apptDate: { type: Type.STRING },
                industry: { type: Type.STRING },
                state: { type: Type.STRING },
              }
            }
          }
        }
      }
    },
    charges: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          chargeId: { type: Type.STRING },
          dateOfCreation: { type: Type.STRING },
          dateOfModification: { type: Type.STRING },
          holderName: { type: Type.STRING },
          amountSecured: { type: Type.STRING },
          natureOfCharge: { type: Type.STRING },
          propertyDescription: { type: Type.STRING },
          termsAndConditions: { type: Type.STRING },
          margin: { type: Type.STRING },
          termsOfRepayment: { type: Type.STRING },
          extentAndOperation: { type: Type.STRING },
          type: { type: Type.STRING, enum: ["creation", "modification"] },
        }
      }
    },
    financials: {
      type: Type.OBJECT,
      properties: {
        complianceStatus: { type: Type.STRING },
        industryCode: { type: Type.STRING },
        industryName: { type: Type.STRING },
        lastAgmDate: { type: Type.STRING },
        lastBalanceSheetDate: { type: Type.STRING },
      }
    },
    other: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: "A concise summary of the document." }
      }
    }
  };

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model,
      contents: `Analyze the following text from an MCA document and extract structured data.
      Type: ${type === 'other' ? customType : type}
      Prompt: ${prompts[type]}
      
      Note: The text may contain raw XML data from an XFA form. If so, prioritize the data within the XML tags as it is often more accurate for government forms.
      
      Text:
      ${text.substring(0, 30000)}`, // Limit text to avoid token issues
      config: {
        responseMimeType: "application/json",
        responseSchema: schemas[type] as any
      }
    });

    return JSON.parse(response.text || "{}");
  });
}

export async function classifyDocument(text: string): Promise<TabType> {
  const model = "gemini-3-flash-preview";
  
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model,
      contents: `Classify the following text from an MCA document into one of these categories:
      - master: Company Master Data (CIN, Company Name, Address)
      - signatories: Signatory Details (Director names, DINs)
      - charges: Charge Documents (Loan amounts, Charge IDs, SRNs)
      - financials: Financials (AOC-4, MGT-7, AGM dates)
      - other: Anything else
      
      Return ONLY the category name.
      
      Text:
      ${text.substring(0, 5000)}`,
      config: {
        responseMimeType: "text/plain",
      }
    });

    const category = response.text?.trim().toLowerCase() as TabType;
    const validCategories: TabType[] = ['master', 'signatories', 'charges', 'financials', 'other'];
    return validCategories.includes(category) ? category : 'other';
  });
}

function truncateData(data: any): any {
  if (typeof data !== 'object' || data === null) return data;
  
  if (Array.isArray(data)) {
    return data.map(truncateData);
  }
  
  const truncated: any = {};
  for (const key in data) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 3000) {
      // Truncate long fields but keep enough for context
      truncated[key] = value.substring(0, 3000) + "... [TRUNCATED FOR BREVITY - SEE ORIGINAL DOCUMENT]";
    } else if (typeof value === 'object') {
      truncated[key] = truncateData(value);
    } else {
      truncated[key] = value;
    }
  }
  return truncated;
}

export async function generateFinalReport(data: ComplianceData): Promise<string> {
  const model = "gemini-3.1-pro-preview";
  
  // Truncate extremely large data fields to avoid token limits
  const processedData = truncateData(data);
  
  const systemInstruction = `You are a professional report formatter for Girdhar & Co. (Chartered Accountants). Your task is to generate a formal ROC Search & Status Report in HTML format suitable for submission to a nationalized bank.

STRICT FORMATTING & PRESENTATION RULES:
1. WRAPPER: Wrap the entire report in <div class="report-container">.
2. FONT & SIZE: Use a uniform font style (Times New Roman) and size (11pt for body, 10pt for table headers) throughout. This is handled by the CSS classes.
3. SECTION HEADINGS: All major section headings MUST use <span class="section-heading">X. SECTION NAME</span> followed by <hr class="section-divider">. Use uppercase for headings.
4. TABLES: Convert ALL data into well-structured tables using <table class="report-table">. This includes:
   - Company Master Data
   - Directors / Signatory Details
   - Share Capital (Authorised, Issued, Subscribed, Paid-up)
   - Other Directorships
   - Charges and Detailed Charge Particulars
5. TABLE QUALITY: Ensure all tables have clear column headers (<th>), proper row alignment, and consistent formatting across pages.
6. ALIGNMENT: Ensure correct alignment of text, especially addresses, tables, and lists. Use professional spacing.
7. REMOVE CLUTTER: Remove unnecessary line breaks, repeated labels, or awkward spacing caused by auto-generated formatting. Ensure clean margins and readable line spacing.
8. TONE: Keep the tone formal, neutral, and corporate. Use professional language (e.g., "The undersigned has conducted a search...", "Based on the documents available on the MCA portal...").
9. LOGICAL FLOW: Preserve the original section numbering (1, 2, 3...) and logical flow of the report.
10. CURRENCY FORMATTING: All currency values must be written as both numerals and words using the Indian numbering system (e.g., ₹75,00,000 – Rupees Seventy-Five Lakhs Only).
11. DATA INTEGRITY: Maintain all original content and data accuracy – do NOT change facts, dates, names, or figures. If data is missing, use <span class="not-available">Not Available on MCA Portal</span>.
12. PAGE BREAKS: Use <div class="page-break"> to force new pages where appropriate (e.g., after the cover page). Wrap each logical section (heading + divider + table) in a <div class="report-section"> to prevent splitting across pages.

STRUCTURE:
1. COVER PAGE (<div class="page-break cover-page">):
   - Header: Firm info (Girdhar & Co.) with logo box.
   - Title Block: "ROC SEARCH & STATUS REPORT" for [Company Name].
   - Office Block: Registered Office address.
   - Behalf Block: "ON BEHALF OF STATE BANK OF INDIA" (or the relevant bank if mentioned).
   - Footer: Reference number and Date.

2. SEARCH REPORT SECTIONS:
   - 1. COMPANY MASTER DATA: Table with CIN, Name, Address, Status, etc.
   - 2. DIRECTORS/SIGNATORY DETAILS: Table with DIN, Name, Designation, Appt Date.
   - 3. SHARE CAPITAL: Detailed table with Authorised and Paid-up capital (numerals + words).
   - 4. COMPANY HIGHLIGHTS: Table of key compliance dates (Last AGM, Last Balance Sheet, Compliance Status).
   - 5. OTHER DIRECTORSHIPS: Individual tables for each director's other directorships.
   - 6. LIST OF CONTINUING CHARGES: Summary table with Charge ID, Holder, Amount, Date.
   - 7. DETAILED CHARGE PARTICULARS:
        Follow these steps strictly for the Charges section:
        
        CRITICAL REQUIREMENT – CHARGE DATA COMPLETENESS:
        - You MUST include ALL charge-related data from ALL provided CHG files without omission.
        - Process EVERY charge entry in the provided data.
        - If any charge data is missing or unreadable (check data.failedDocuments), explicitly mention: "Charge data could not be extracted from [filename/ID]".
        - If the provided description is marked as [TRUNCATED], include the text as provided and append a note: "(Full details available in the original CHG form)".
        
        STEP 1 — IDENTIFY OPEN/ACTIVE CHARGES ONLY:
        From MCA Master Data (data.masterData.indexOfCharges), scan "Date of Satisfaction".
        - If "Date of Satisfaction" is BLANK/NULL → charge is OPEN/ACTIVE → INCLUDE IT
        - If "Date of Satisfaction" has any date → charge is CLOSED/SATISFIED → EXCLUDE IT
        Always use MCA Master Data as the authority for "Open" status.
        
        STEP 2 — CLASSIFY EACH OPEN CHARGE:
        For each open charge from Step 1, check "Date of Modification" in MCA Master Data:
        - If "Date of Modification" is BLANK/NULL → SINGLE ENTRY CHARGE
        - If "Date of Modification" has a date → MODIFIED CHARGE
        
        STEP 3 — EXTRACT DETAILS FROM CHG DATA (data.charges):
        - For SINGLE ENTRY CHARGES: Extract full details from the CHG data entry for that Charge ID.
        - For MODIFIED CHARGES: Extract TWO entries for that Charge ID:
          1. FIRST ENTRY: The "creation" type entry.
          2. LAST ENTRY: The latest "modification" type entry by date.
        
        STEP 4 — OUTPUT FORMAT:
        Present in two sub-groups:
        A) SINGLE ENTRY CHARGES (No Modifications): List each with full details in a block.
        B) CHARGES WITH MODIFICATIONS: For each, show two rows: "First Created" and "Last Modified".
        
        VALIDATION (MANDATORY):
        - Count total number of CHG files provided (data.chgFileCount).
        - Count total number of charges included in the report.
        - If any file is not processed or any charge is missing, STOP and output: "ERROR: Incomplete charge data. Some CHG files were not processed."
        
        IMPORTANT:
        - Total open charges must match the count in MCA Master Data.
        - Do NOT include satisfied charges.
        - If details are missing in ROC report for an open charge, note "Details not available in ROC Report".
        - Each charge/group should be in a <div class="report-section no-break">.

3. FINAL PAGE:
   - Disclaimer: A standard professional disclaimer about the scope and limitations of the search.
   - Signature block aligned to the RIGHT using <div class="signature-block">.
   - Include: Firm name, CA name, Membership number, Place, Date, and UDIN.

GENERAL:
- No text overflow. Wrap text in cells.
- Professional typography (Times New Roman style).
- Ensure all section headings are bold, numbered, and followed by <hr class="section-divider">.
- If the report is becoming extremely long, prioritize clarity and essential facts over repeating every word of long legal boilerplate.`;

  const userPrompt = `Generate the formal ROC Search & Status Report based on this data:
  ${JSON.stringify(processedData, null, 2)}
  
  Ensure all currency values are converted to words. Ensure no tables are split across pages. The report must be bank-ready. Use the original section numbering and logical flow.`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.1,
      }
    });

    let html = response.text || "";
    // Strip markdown code blocks if present
    html = html.replace(/^```html\n?/, "").replace(/\n?```$/, "").trim();
    return html;
  });
}
