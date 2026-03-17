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
  
  const systemInstruction = `You are a professional report formatter for Girdhar & Co. (Chartered Accountants). When given a document, you extract all data and reproduce it as a clean, complete, formally structured HTML report. You never skip sections, never write "null" or "N/A" or "not found", and never shorten legal text.

STYLE RULES (PDF):
- Wrap the entire output in <div class="pdf-report">.
- Start with <div class="pdf-intro">ROC Search & Status Report Prepared by Girdhar & Co.</div>.
- Followed by <div class="pdf-title">CORPORATE COMPLIANCE & SEARCH REPORT</div>.
- Followed by <div class="pdf-subtitle">Report Period: FY 2025-26 | Generated on ${new Date().toLocaleDateString('en-IN')}</div>.
- Followed by <hr class="pdf-divider">.
- Use <div class="pdf-section-heading">X. SECTION NAME</div> for numbered bold headings.
- Use <table class="pdf-table"> for all tabular data.
- Table header rows MUST have specific classes:
  * <thead class="pdf-table-header-navy"> for primary data (Master Data, Financials).
  * <thead class="pdf-table-header-blue"> for sub-tables (Other Directorships).
  * <thead class="pdf-table-header-teal"> for positive data (Active status, satisfied charges).
  * <thead class="pdf-table-header-red"> for warnings (Struck off, disqualified directors, open charges).
  * <thead class="pdf-table-header-gray"> for neutral info (SRN lists).
- For non-table content, use <span class="pdf-label">LABEL</span> followed by <span class="pdf-body-text">VALUE</span>.
- Use standard <ul> and <li> for bullet points.
- Every page will have a footer (handled by CSS, but you can assume it exists).

CONTENT RULES:
- Extract every piece of data directly from the provided structured data.
- Section 1: Company Master Data — Include company name, CIN, dates, capitals (with amount in words), address, status.
- Section 2: Signatory Details — One table per director with DIN, designation, appointment date, remuneration, disqualification status, and their other directorships (in a sub-table).
- Section 3: Charge Documents — One table per charge with charge ID, SRN, amount, holder name, property description, interest rate, repayment terms, and all legal text in full.
- Section 4: Financial Compliance — Compliance status, industry code, AGM date, balance sheet date, and a list of all SRNs.
- Section 5: Other Documents — One entry per document with its full summary.
- Reproduce all legal text, property descriptions, charge details, and address fields word for word. Never summarise or shorten them.
- Every monetary amount must show both the figure and the words. Example: Rs. 7,50,00,000 (Rupees Seven Crore Fifty Lakhs only).
- All dates in DD/MM/YYYY format. Status values always written in full: Active, Strike Off, Amalgamated.

OUTPUT RULE:
- Generate the complete HTML report in one response. Do not add commentary.`;

  const userPrompt = `Generate the professional ROC Search & Status Report based on this data:
  ${JSON.stringify(data, null, 2)}
  
  Ensure you follow all styling and content rules strictly. The report is for State Bank of India.`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.1,
      }
    });

    return response.text || "";
  });
}
