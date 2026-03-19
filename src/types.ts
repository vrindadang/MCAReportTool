/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MasterData {
  companyName: string;
  cin: string;
  registrationDate: string;
  authorizedCapital: string;
  paidUpCapital: string;
  registeredAddress: string;
  companyStatus: string;
  authorizedCapitalWords?: string;
  paidUpCapitalWords?: string;
  authorizedCapitalShares?: string;
  paidUpCapitalShares?: string;
  faceValue?: string;
  age?: string;
  companyClass?: string;
  companyCategory?: string;
  companySubCategory?: string;
  emailId?: string;
  lastAgmDate?: string;
  lastBalanceSheetDate?: string;
  activeCompliance?: string;
  indexOfCharges?: Charge[];
}

export interface Signatory {
  din: string;
  name: string;
  designation: string;
  appointmentDate: string;
  remuneration?: string;
  disqualificationStatus?: string;
  totalDirectorships?: string;
  otherDirectorships?: Array<{
    companyName: string;
    status: string;
    apptDate: string;
    industry: string;
    state: string;
  }>;
}

export interface Charge {
  srn: string;
  chargeId: string;
  amount: string;
  holderName: string;
  propertyDescription: string;
  interestRate?: string;
  repaymentTenure?: string;
  propertyBoundaries?: string;
  dateOfCreation?: string;
  dateOfModification?: string;
  dateOfSatisfaction?: string;
  amountSecured?: string;
  natureOfCharge?: string;
  termsAndConditions?: string;
  margin?: string;
  termsOfRepayment?: string;
  extentAndOperation?: string;
  type?: 'creation' | 'modification';
}

export interface Financials {
  complianceStatus: string;
  industryCode: string;
  industryName?: string;
  lastAgmDate: string;
  lastBalanceSheetDate: string;
}

export interface ComplianceData {
  masterData?: MasterData;
  signatories: Signatory[];
  charges: Charge[];
  financials?: Financials;
  rawSRNs: string[];
  chgFileCount: number;
  failedDocuments: string[];
  otherDocuments: { [key: string]: string }; // Stores extracted summaries for custom docs
}

export type TabType = 'master' | 'signatories' | 'charges' | 'financials' | 'other';
