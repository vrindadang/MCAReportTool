import { GoogleGenAI, Type } from "@google/genai";
import { ComplianceData, MasterData, Signatory, Charge, Financials, TabType } from "../types";
import { withRetry } from "../utils/retry";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeDocument(text: string, type: TabType, fileName?: string, customType?: string): Promise<any> {
  const model = "gemini-3-flash-preview";
  
  const prompts = {
    master: `You are extracting Company Master Data from an MCA ROC Search & Status Report.

    Extract EVERY field listed below. If a field is genuinely not present in the document, return an empty string — do NOT guess or invent values.

    Fields to extract:
    - companyName: Full legal name of the company
    - cin: Corporate Identification Number (format: U/L + digits + state code + PLC/PTC + digits)
    - registrationDate: Date of incorporation/registration (DD/MM/YYYY)
    - age: Age of company in years (e.g., "87 Years" or "87.8 Years")
    - companyStatus: Active / Strike Off / Amalgamated / Under Liquidation etc.
    - companyClass: Public / Private
    - companyCategory: Company limited by shares / guarantee / unlimited
    - companySubCategory: Indian Non-Government Company / Government Company etc.
    - companyIndustry: Full industry classification name (e.g., "Manufacture Of Chemicals And Chemical Products")
    - registeredAddress: Full registered office address including floor, building, road, city, state, pin
    - emailId: Official email address of company
    - authorizedCapital: In numerals only (e.g., "19500000")
    - authorizedCapitalWords: In Indian words (e.g., "Rupees One Crore Ninety-Five Lakhs Only")
    - authorizedCapitalShares: Number of shares (e.g., "1950000 shares of Rs 10 each")
    - faceValue: Face value per share (e.g., "Rs 10")
    - paidUpCapital: In numerals only (e.g., "3868580")
    - paidUpCapitalWords: In Indian words (e.g., "Rupees Thirty-Eight Lakhs Sixty-Eight Thousand Five Hundred Eighty Only")
    - paidUpCapitalShares: Number of shares (e.g., "386858 shares of Rs 10 each")
    - lastAgmDate: Date of last Annual General Meeting (DD/MM/YYYY)
    - lastBalanceSheetDate: Date of last Balance Sheet filed (DD/MM/YYYY)
    - activeCompliance: Compliance status (e.g., "ACTIVE Compliant")
    - openChargesCount: Number of open/continuing charges (integer as string, e.g., "7")
    - bankName: Name of the bank/institution on whose behalf this report is prepared (e.g., "State Bank of India")
    - referenceNumber: Report reference number if present (e.g., "SBI / SR & ST/2025-26")
    - reportDate: Date of this report (DD/MM/YYYY or DD-Mon-YYYY)
    - indexOfCharges: Array of ALL charges listed in the Index/List of Charges table. For each charge extract:
        - chargeId: Charge ID number
        - holderName: Name of charge holder (bank/institution)
        - amount: Amount secured in numerals
        - dateOfCreation: Date charge was created
        - dateOfModification: Date of last modification (empty string if none)
        - dateOfSatisfaction: Date of satisfaction/closure (empty string if still open)`,
    signatories: `You are extracting Director and Signatory details from an MCA ROC Search & Status Report.

    Extract ALL directors and signatories listed. For each person extract:
    - din: Director Identification Number (DIN) or PAN (may be partially masked e.g. *****2270J)
    - name: Full name in UPPERCASE as it appears
    - designation: Exact designation (Director / Whole-time director / Company Secretary / Managing Director / Independent Director etc.)
    - appointmentDate: Date of appointment (DD/MM/YYYY)
    - totalDirectorships: Total number of directorships held (as string, e.g., "11")
    - disqualificationStatus: "Not Disqualified" / "Disqualified" / blank
    - otherDirectorships: Array of OTHER companies this director holds position in (exclude the current company). For each:
        - companyName: Full company name in UPPERCASE
        - status: Active / Strike Off / Amalgamated / Under Liquidation
        - apptDate: Date of appointment (DD/MM/YYYY)
        - industry: Industry classification name
        - state: State (e.g., "Chennai" or "Tamil Nadu")

    IMPORTANT: Extract other directorships even if they are shown in a combined table. The "Other Directorships" section lists all companies ASSOCIATED with each director including the current company — extract only the OTHER companies (not the one this report is about).`,
    charges: `You are extracting charge details from an MCA CHG (Charge Registration) form.

    This document may contain ONE or MORE charges. Extract ALL charges found.

    For EACH charge, extract:
    - chargeId: Charge ID number (e.g., "100452823" or "AC0432006")
    - type: "creation" if this is the original charge creation, "modification" if this is a modification entry
    - dateOfCreation: Date the charge was originally created (DD/MM/YYYY)
    - dateOfModification: Date of this modification entry if type is "modification" (DD/MM/YYYY), else empty
    - holderName: Full legal name of charge holder (bank/financial institution) IN CAPS
    - holderAddress: Full address of charge holder
    - amountSecured: Amount secured — include BOTH numerals (e.g., "75000000") AND words (e.g., "Rupees Seven Crore Fifty Lakhs Only")
    - natureOfCharge: Full nature/type description (e.g., "Hypothecation of current assets and Equitable Mortgage" or "Deed of Hypothecation. Movable property - Inventory (incl. Receivables)")
    - propertyDescription: COMPLETE verbatim property description — DO NOT summarize or truncate. Include all sub-clauses, plot numbers, survey numbers, and legal descriptions.
    - extentAndOperation: COMPLETE verbatim extent and operation clause — DO NOT summarize.
    - termsAndConditions: Rate of interest, nature of facility, and all conditions
    - termsOfRepayment: Repayment schedule/terms (e.g., "Monthly" / "Payable on Demand" / "12 Months" / "48 Months")
    - margin: Margin percentage or description (e.g., "25% on Stocks; 30% on Book Debts" or "NIL" or "100% cash margin")

    CRITICAL RULES:
    1. Do NOT summarize or shorten propertyDescription or extentAndOperation — copy them verbatim in full.
    2. If the document contains both a "First Created" entry and a "Last Modified" entry for the same Charge ID, return BOTH as separate objects — one with type "creation" and one with type "modification".
    3. Do NOT return fileReadError: true unless the document is genuinely blank or unreadable (fewer than 100 meaningful characters).`,
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
        age: { type: Type.STRING },
        companyIndustry: { type: Type.STRING },
        openChargesCount: { type: Type.STRING },
        authorizedCapital: { type: Type.STRING },
        authorizedCapitalWords: { type: Type.STRING },
        authorizedCapitalShares: { type: Type.STRING },
        paidUpCapital: { type: Type.STRING },
        paidUpCapitalWords: { type: Type.STRING },
        paidUpCapitalShares: { type: Type.STRING },
        faceValue: { type: Type.STRING },
        bankName: { type: Type.STRING },
        referenceNumber: { type: Type.STRING },
        reportDate: { type: Type.STRING },
        registeredAddress: { type: Type.STRING },
        companyStatus: { type: Type.STRING },
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
          holderAddress: { type: Type.STRING },
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
          fileReadError: { type: Type.BOOLEAN },
          errorReason: { type: Type.STRING },
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

  const schemas_any = schemas as any;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model,
      contents: `CRITICAL INSTRUCTION - FILE READING FAILURE DETECTION:
      Before extracting any data, first assess whether the uploaded document was successfully read. A document has FAILED to be read if ANY of the following are true:
      1. The extracted text contains phrases like "Please wait...", "upgrade Adobe Reader", "If this message is not eventually replaced", or "your PDF viewer may not be able to display this type of document"
      2. The extracted text is fewer than 200 characters of meaningful content
      3. The text contains only form template labels (field names) but NO actual data values (e.g., fields like "Name of company", "Amount secured", "Rate of interest" appear but have no corresponding filled values next to them)
      4. The text is entirely blank or whitespace

      If ANY of the above conditions are met, you MUST return a special failure object instead of a normal entry:
      {
        "chargeId": "UNREADABLE",
        "holderName": "${fileName || "FILE COULD NOT BE READ"}",
        "propertyDescription": "FAILED: This file could not be parsed. It is likely an XFA-based dynamic PDF form that requires Adobe Reader or flattening before processing. Please flatten this PDF and re-upload.",
        "amountSecured": "N/A",
        "dateOfCreation": "N/A",
        "type": "creation",
        "fileReadError": true,
        "errorReason": "[State the specific reason — e.g., XFA form detected / text too short / template labels only with no values]"
      }
      (Adapt this object for other document types if necessary, but keep fileReadError: true and errorReason).

      Analyze the following text from an MCA document and extract structured data.
      Type: ${type === 'other' ? customType : type}
      Prompt: ${prompts[type]}
      
      Note: The text may contain raw XML data from an XFA form. If so, prioritize the data within the XML tags as it is often more accurate for government forms.
      
      Text:
      ${text.substring(0, 30000)}`, // Limit text to avoid token issues
      config: {
        responseMimeType: "application/json",
        responseSchema: schemas_any[type]
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
  const model = "gemini-3-flash-preview";
  
  // Truncate extremely large data fields to avoid token limits
  const processedData = truncateData(data);
  
  const systemInstruction = `You are a professional report formatter for Girdhar & Co. (Chartered Accountants). 
  Generate a complete, formal ROC Search & Status Report in clean HTML, ready for submission to a nationalised bank.

  ═══════════════════════════════════════════
  FORMATTING & LAYOUT RULES
  ═══════════════════════════════════════════
  - The entire report is wrapped in <div class="report-container">.
  - Font: Times New Roman, 11pt body, 10pt table content, 12pt headings.
  - All content is LEFT-ALIGNED within a centred page container (max-width 900px, margin: 0 auto).
  - Section headings: Bold, uppercase, numbered, followed by a full-width <hr>.
  - All data is presented in <table class="report-table"> with clear <th> headers.
  - Currency values always shown as: ₹75,00,00,000 (Rupees Seventy-Five Crores Only).
  - Missing data: <span class="not-available">Not Available on MCA Portal</span>
  - Page breaks: <div class="page-break"> between major sections.
  - No inline styles except for the signature block alignment.
  - CRITICAL: Do NOT include any warnings, alerts, error messages, or "missing file" notifications about unreadable documents or failed extractions. Only present the data that IS available.

  ═══════════════════════════════════════════
  MANDATORY REPORT STRUCTURE (in exact order)
  ═══════════════════════════════════════════

  PAGE 1 — COVER PAGE
  ──────────────────
  - Logo/letterhead block: "GIRDHAR & CO. | Chartered Accountants"
    Address: 5342, Gali no 68, Reghar Pura, Karol Bagh, New Delhi - 110005
    Mobile: 9899997602, 9899997603 | Email: rahul.girdhar87@gmail.com
  - Title: "ROC SEARCH & STATUS REPORT" (large, bold, centred)
  - Subtitle: "OF" then company name in bold
  - CIN line
  - Registered Office label + full address (bold)
  - "PREPARED ON BEHALF OF" then bank name
  - Reference number and date (bottom)

  PAGE 2 ONWARDS — REPORT BODY

  SECTION 1 — COMPANY MASTER DATA
  Table with these EXACT rows (in order):
  1. Corporate Identification Number (CIN)
  2. Company Name
  3. Date of Incorporation (with age in years)
  4. Company Status
  5. Company Category
  6. Company Class
  7. Company Sub-Category
  8. Company Industry Classification
  9. Registered Office Address
  10. Email ID
  11. Date of Last AGM
  12. Date of Last Balance Sheet Filed
  13. Active Compliance Status

  SECTION 2 — DIRECTORS / SIGNATORY DETAILS
  Table columns: S.No | DIN / PAN | Name of Director/Signatory | Designation | Date of Appointment | Total Directorships | Disqualification Status

  Note below table (if applicable):
  "There are no directors in this company who are Disqualified by ROC u/s 164(2). No DIN is deactivated due to non-filing of DIR-3 KYC."

  SECTION 3 — SHARE CAPITAL
  Table with rows:
  1. Authorised Capital — ₹X,XX,XX,XXX (Words) | Divided into X shares of Rs 10 each
  2. Paid-up Capital — ₹X,XX,XXX (Words) | Divided into X shares of Rs 10 each

  SECTION 4 — COMPANY HIGHLIGHTS
  Table with rows:
  1. CIN
  2. Age (Incorporation Date)
  3. Company Status
  4. Company Class
  5. Company Category
  6. Company Sub-Category
  7. Company Industry
  8. Authorised Capital
  9. Paid-up Capital
  10. Open Charges (count)
  11. Last AGM Date
  12. Balance Sheet Date
  13. Email ID
  14. Address

  SECTION 5 — OTHER DIRECTORSHIPS
  For EACH director (numbered 1, 2, 3...):
  Sub-heading: "[NUMBER]. [DIRECTOR NAME] — (DIN: XXXXXXXX)"
  Table columns: S.No | Current Company | Status | Date of Appointment | Industry | State
  Show ALL other directorships. If a director has no other directorships, write "Only directorship is in the current company."

  SECTION 6 — LIST OF CONTINUING (OPEN) CHARGES
  Introductory note: "The following open charges have been identified based on records available at the MCA portal as on the date of inspection:"
  Table columns: Sl.No | Charge ID | Charge Holder Name | Amount (₹) | Date of Creation | Date of Last Modification

  IMPORTANT: Include ONLY open charges (Date of Satisfaction is blank). List ALL of them.

  SECTION 7 — COMPANY INDUSTRY CLASSIFICATION
  Single paragraph: "Manufacture of Chemicals and Chemical Products." (or whatever the industry is)

  SECTION 8 — DETAILED CHARGE PARTICULARS
  Sub-heading A: "A) SINGLE ENTRY CHARGES (No Modifications)"
  For each single-entry charge, show a detail block:
    Header: "Charge Created on [DATE] vide Charge ID [ID]"
    Table with rows:
    1. Name & Address of Institution in whose favour Charge is Created
    2. Amount Secured by the Charge (numerals + words)
    3. Brief Particulars of Property Charged (FULL TEXT — do not truncate)
    4. Terms and Conditions (interest rate, facility type)
    5. Margin
    6. Terms of Repayment
    7. Extent and Operation of the Charge (FULL TEXT — do not truncate)

  Sub-heading B: "B) CHARGES WITH MODIFICATIONS"
  For each modified charge, show TWO blocks:
    Block 1 header: "Charge Created on [CREATION DATE] vide Charge ID [ID]"  
    (Show creation-time details as above)
    Block 2 header: "[ID].1M Charge Modification on [MODIFICATION DATE] vide Charge ID [ID]"
    (Show modification-time details — updated amount, property description, extent and operation)

  SECTION 9 — POTENTIAL RELATED PARTIES
  Table columns: S.No | Current Company | Status | Age of Company (Years) | State | No. of Common Directors
  List all related-party companies connected via common directors with the current company.
  Source this from otherDirectorships data across all directors.

  FINAL PAGE — DISCLAIMER & SIGNATURE
  Disclaimer paragraph:
  "The undersigned has conducted a search of the public documents of [COMPANY NAME] available on the MCA portal. This report is based solely on the documents, forms, and returns filed by the company and available for public inspection on the Ministry of Corporate Affairs (MCA) website as of the date of the search. While every effort has been made to ensure the accuracy and completeness of this report, Girdhar & Co. does not guarantee the authenticity or validity of the documents filed by the company. We assume no responsibility for any errors, omissions, or discrepancies in the MCA records, nor for any unfiled, pending, or delayed documents. This report is intended exclusively for the use of [BANK NAME] and should not be relied upon by any third party without prior written consent."

  Signature block (right-aligned):
  For Girdhar & Co.
  Chartered Accountants
  FRN: 038149N
  [signature image placeholder box]
  CA Rahul Girdhar
  Proprietor
  M. No. 530483
  Place: Delhi
  Date: [REPORT DATE]
  UDIN: [UDIN if available]

  ═══════════════════════════════════════════
  DATA COMPLETENESS RULES
  ═══════════════════════════════════════════
  1. NEVER omit a charge that appears in data.masterData.indexOfCharges.
  2. For every open charge in the index, find its detailed data in data.charges by matching chargeId. If not found, skip the detailed block for that charge (do NOT write "Details not available").
  3. Show creation + all modification entries for modified charges.
  4. ICICI / HDFC charges: show BOTH the original creation details AND the modification details in separate blocks.
  5. The Related Parties section (Section 9) must be populated from otherDirectorships data — do not omit it.
  6. Currency: always show ₹ symbol + Indian comma notation + words. Example: ₹12,12,12,443 (Rupees Twelve Crore Twelve Lakhs Twelve Thousand Four Hundred Forty-Three Only).
  7. SPEED & CONCISENESS: Be direct. Do not add fluff. Generate the HTML as quickly as possible.`;

  const userPrompt = `Generate the complete formal ROC Search & Status Report based on this extracted data.

  EXTRACTED DATA:
  ${JSON.stringify(processedData, null, 2)}

  MANDATORY CHECKLIST — verify before finalising:
  □ Cover page has: firm letterhead, company name, CIN, registered address, bank name, ref number, date
  □ Section 1 has all 13 master data rows including industry classification
  □ Section 2 directors table includes Total Directorships column
  □ Section 3 share capital includes share count breakdown
  □ Section 4 company highlights includes open charges count
  □ Section 5 other directorships lists industry and state for each entry
  □ Section 6 charge list includes ALL ${processedData.masterData?.openChargesCount || 'all'} open charges
  □ Section 8 charge details: every open charge has a detail block; modified charges have TWO blocks each
  □ Section 9 related parties table is present and populated
  □ All currency amounts written in both numerals and Indian words
  □ Disclaimer and signature block on final page

  Output ONLY the HTML — no markdown fences, no explanation text.`;

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
