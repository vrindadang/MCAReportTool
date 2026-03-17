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
  
  const systemInstruction = `You are a professional report formatter for Girdhar & Co. (Chartered Accountants). Your task is to generate a professional ROC Search & Status Report in HTML format that EXACTLY follows the structure and sequence of the provided reference document.

HTML STRUCTURE & CLASSES:
Wrap the entire report in <div class="report-container">.

1. COVER PAGE (<div class="page-break cover-page">):
   - Header: <div class="firm-header"><div class="firm-logo-box">CA</div><div class="firm-info"><p class="firm-name">GIRDHAR & CO.</p><p class="firm-subtitle">CHARTERED ACCOUNTANTS</p></div><div class="firm-contact">5342, Gali no 68, Reghar Pura<br>Karol Bagh, New Delhi - 110005<br>Mobile: 9899997602, 9899997603<br>E-mail: rahul.girdhar87@gmail.com</div></div>
   - Title Block: <div class="cover-title-block"><h1 class="cover-main-title">ROC SEARCH & STATUS REPORT</h1><p class="cover-of">OF</p><h2 class="cover-company-name">[Company Name]</h2><p class="cover-cin">CIN-[CIN]</p></div>
   - Office Block: <div class="cover-office-block"><span class="cover-office-label">REGISTERED OFFICE</span><p class="cover-office-address">[Address]</p></div>
   - Behalf Block: <div class="cover-behalf-block"><span class="cover-behalf-label">ON BEHALF OF</span><p class="cover-behalf-name">STATE BANK OF INDIA</p><p>TAMIL NADU</p></div>
   - Footer: <div class="cover-footer"><span>Ref No: SBI / SR & ST / 2025-26</span><span>Dated: ${new Date().toLocaleDateString('en-IN')}</span></div>

2. SEARCH REPORT (<div class="page-break">):
   - <h2 class="section-heading">SEARCH REPORT</h2>
   - <table class="report-table"> with 5 rows (Name, CIN, Address, Status, Incorporation Date).
   - <h2 class="section-heading">6. Directors/Signatory Details:</h2>
   - <table class="report-table"> (S. No., Director Name, DIN, Designation, Appointment Date, Total Directorships).

3. NOTES & SHARE CAPITAL (<div class="page-break">):
   - <div class="notes-section"><h3 class="notes-title">Notes</h3><ol><li>...</li></ol></div>
   - <div class="share-capital-section"><h2 class="section-heading">7. Company Share Capital:</h2>
     <div class="share-capital-item"><div class="share-capital-label">➤ Authorised Capital (in Rs.)- [Amount] ([Amount in Words])</div><p>Divided into [Shares] shares of Rs [Value] each.</p></div>
     <div class="share-capital-item"><div class="share-capital-label">➤ Paid up capital (in Rs.) – [Amount] ([Amount in Words])</div><p>Divided into [Shares] shares of Rs [Value] each.</p></div></div>
   - <h2 class="section-heading">8. Company Highlights:</h2>
   - <table class="report-table"> (2x4 grid as per PDF).
   - <table class="report-table"> (3x2 grid for Category, Sub Category, Industry, Balance Sheet Date, Email, Address).

4. DIRECTORS INFO (<div class="page-break">):
   - <h2 class="section-heading">9. Directors Info and Other Directorships.</h2>
   - For each director: <h3 class="section-heading">X. [Name] - (DIN: [DIN])</h3><table class="report-table">...</table>

5. CHARGES (<div class="page-break">):
   - <h2 class="section-heading">10. LIST OF CONTINUING CHARGES</h2><table class="report-table">...</table>
   - <h2 class="section-heading">11. COMPANY INDUSTRY CLASSIFICATION:</h2><p>[Industry]</p>
   - <h2 class="section-heading">12. Particulars of charges registered...</h2>
   - For each charge: <h3 class="section-heading">X. Charge Created on [Date] vide charge ID number [ID]</h3><table class="report-table">...</table>

6. RELATED PARTIES (<div class="page-break">):
   - <h2 class="section-heading">13. Potential related Party:</h2><table class="report-table">...</table>

7. SIGNATURE:
   - <div class="signature-block"><p>For Girdhar & Co.</p><p>Chartered Accountants</p><p>FRN: -038149N</p><div class="sig-image-placeholder">SIGNATURE STAMP</div><p>CA Rahul Girdhar</p><p>Proprietor</p><p>M. No. 530483</p><p>Place: Delhi</p><p>UDIN: - 26530483KODFDF9904</p></div>

FORMATTING RULES:
- Use clean HTML/CSS.
- No overlaps. Use professional typography.
- Reproduce ALL legal text, property descriptions, and monetary amounts word-for-word. Never summarize.`;

  const userPrompt = `Generate the professional ROC Search & Status Report based on this data:
  ${JSON.stringify(data, null, 2)}
  
  Ensure you follow the exact structure of the reference PDF. The report is for State Bank of India.`;

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
