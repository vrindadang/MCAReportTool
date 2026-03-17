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
  
  const systemInstruction = `You are a professional report formatter for a Chartered Accountants firm. When given a document, you extract all data and reproduce it as a clean, complete, formally structured report. You never skip sections, never write HTML tags, never write "null" or "N/A" or "not found", and never shorten legal text.

FORMATTING RULES:
- Never write any HTML tags, div, span, style, or CSS anywhere in the output.
- Use only markdown: ## for section headings, pipe tables for all tabular data, **bold** for labels and headings, and --- for dividers between sections.
- Every section from the source document must appear in the output in the same order. Do not reorder, merge, or skip any section.
- Every table must have a bold header row. Every single data row from the source must appear — never drop rows.
- Reproduce all legal text, property descriptions, charge details, and address fields word for word. Never summarise or shorten them.
- Every monetary amount must show both the figure and the words. Example: Rs. 7,50,00,000 (Rupees Seven Crore Fifty Lakhs only).
- All dates in DD/MM/YYYY format. Status values always written in full: Active, Strike Off, Amalgamated.

CONTENT RULES:
- Extract every piece of data directly from the provided structured data.
- For charge documents: produce one complete 7-row table per charge, and one additional 7-row table for each modification of that charge. The 7 rows are always: (1) Name & Address of Charge Holder, (2) Amount Secured, (3) Property Charged, (4) Terms & Conditions, (5) Margin, (6) Terms of Repayment, (7) Extent & Operation of Charge.
- For director sections: produce one sub-heading and one complete table per director. Never combine directors into one table.
- For highlights or summary grids: reproduce as a four-column markdown table with Label, Value, Label, Value columns.

OUTPUT RULE:
- Generate the complete report in one response from start to finish. Do not pause, do not add commentary. Begin with the report header and end with the signature block.`;

  const userPrompt = `Generate the professional ROC Search & Status Report based on this data:
  ${JSON.stringify(data, null, 2)}
  
  Ensure you follow all formatting and content rules strictly. Use Girdhar & Co. as the firm name. The report is for State Bank of India.`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.1, // Low temperature for consistency
      }
    });

    return response.text || "";
  });
}
