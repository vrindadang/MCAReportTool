import { GoogleGenAI, Type } from "@google/genai";
import { ComplianceData, MasterData, Signatory, Charge, Financials, TabType } from "../types";
import { withRetry } from "../utils/retry";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeDocument(text: string, type: TabType, customType?: string): Promise<any> {
  const model = "gemini-3-flash-preview";
  
  const prompts = {
    master: "Extract Company Master Data: Company Name, CIN, Registration Date, Authorized Capital, Paid-up Capital, Registered Address, and Company Status (e.g., ACTIVE, Struck Off).",
    signatories: "Extract Signatory Details: List of Directors with DIN, Name, Designation (e.g., Deputy Managing Director), Appointment Date, Remuneration/Salary Scale, and any Disqualification Status.",
    charges: "Extract Charge Documents: SRN, Charge ID, Amount, Holder Name, Property Description (e.g., specific vehicle models, land survey numbers). Specifically look for Interest Rates and Repayment Tenures.",
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
          srn: { type: Type.STRING },
          chargeId: { type: Type.STRING },
          amount: { type: Type.STRING },
          holderName: { type: Type.STRING },
          propertyDescription: { type: Type.STRING },
          interestRate: { type: Type.STRING },
          repaymentTenure: { type: Type.STRING },
          propertyBoundaries: { type: Type.STRING },
          dateOfCreation: { type: Type.STRING },
          dateOfLastModification: { type: Type.STRING },
          amountSecured: { type: Type.STRING },
          termsAndConditions: { type: Type.STRING },
          margin: { type: Type.STRING },
          termsOfRepayment: { type: Type.STRING },
          extentAndOperation: { type: Type.STRING },
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

export async function generateFinalReport(data: ComplianceData): Promise<string> {
  const model = "gemini-3.1-pro-preview";
  
  const systemInstruction = `You are a professional report formatter for Girdhar & Co. (Chartered Accountants). Your task is to generate a formal ROC Search & Status Report in HTML format suitable for submission to a nationalized bank.

STRICT LAYOUT & FORMATTING RULES:
1. Wrap the entire report in <div class="report-container">.
2. Use <div class="page-break"> to force new pages where appropriate (e.g., after the cover page).
3. Use <div class="report-section"> for each major section to prevent tables from splitting across pages.
4. All section headings MUST be bold, numbered (e.g., 1., 2.), and followed by <hr class="section-divider">.
5. All tables MUST use <table class="report-table"> with <thead> and <tbody>.
6. Header rows (<th>) must be shaded light grey (handled by CSS).
7. CURRENCY FORMATTING: All currency values must be written as both numerals and words using the Indian numbering system (e.g., ₹75,00,000 – Rupees Seventy-Five Lakhs Only). Use 'Lakhs' and 'Crores' as appropriate.
8. DATA INTEGRITY: Replace all placeholders like [Shares], [Value], [Not Available] with actual data. If data is missing, use <span class="not-available">Not Available on MCA Portal</span>.
9. PAGINATION: Ensure headings stay with their tables. Wrap each logical section (heading + divider + table) in a <div class="report-section">. This class has "page-break-inside: avoid".
10. CHARGES: Each charge must be in its own <div class="report-section no-break"> to ensure it never splits across pages. Use a sub-table for each charge.
11. TONE: Maintain a formal, neutral, and corporate tone. Use professional language (e.g., "The undersigned has conducted a search...", "Based on the documents available on the MCA portal...").
12. TABLES: Convert all data into well-structured tables. This includes Master Data, Signatory Details, Share Capital, Other Directorships, and Charges.

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
   - 4. COMPANY HIGHLIGHTS: Grid/Table of key compliance dates (AGM, Balance Sheet).
   - 5. OTHER DIRECTORSHIPS: Individual tables for each director's other directorships.
   - 6. LIST OF CONTINUING CHARGES: Summary table with Charge ID, Holder, Amount, Date.
   - 7. DETAILED CHARGE PARTICULARS: Each charge in its own <div class="report-section no-break"> block with a sub-table showing SRN, Property Description, Interest Rate, Terms of Repayment, etc.

3. FINAL PAGE:
   - Disclaimer: A standard professional disclaimer about the scope and limitations of the search.
   - Signature block aligned to the RIGHT using <div class="signature-block">.
   - Include: Firm name, CA name, Membership number, Place, Date, and UDIN.

GENERAL:
- No text overflow. Wrap text in cells.
- Professional typography (Times New Roman style).
- Ensure all section headings are bold, numbered, and followed by <hr class="section-divider">.`;

  const userPrompt = `Generate the formal ROC Search & Status Report based on this data:
  ${JSON.stringify(data, null, 2)}
  
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
