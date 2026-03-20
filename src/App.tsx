/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { 
  FileText, 
  Users, 
  CreditCard, 
  BarChart3, 
  Upload, 
  FileCheck, 
  Loader2,
  ChevronRight,
  Download,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import html2pdf from 'html2pdf.js';

import { ComplianceData, TabType } from './types';
import { extractTextFromPDF } from './services/pdf';
import { analyzeDocument, generateFinalReport, classifyDocument } from './services/gemini';
import { withRetry } from './utils/retry';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TABS = [
  { id: 'master', label: 'Master Data', icon: FileText, description: 'Company info, Capital, Dates' },
  { id: 'signatories', label: 'Signatory Details', icon: Users, description: 'Director names, DINs' },
  { id: 'charges', label: 'CHG Forms / Charge Docs', icon: CreditCard, description: 'Loan amounts, Property descriptions' },
  { id: 'financials', label: 'Financials (AOC-4/MGT-7)', icon: BarChart3, description: 'Compliance status, Industry code' },
] as const;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('master');
  const [data, setData] = useState<ComplianceData>({
    signatories: [],
    charges: [],
    rawSRNs: [],
    chgFileCount: 0,
    failedDocuments: [],
    otherDocuments: {}
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number, total: number, fileName?: string } | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [srnInput, setSrnInput] = useState('');
  const [customDocName, setCustomDocName] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: TabType, customName?: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file, type, customName);
  };

  const processFile = async (file: File, type: TabType, customName?: string) => {
    setIsAnalyzing(true);
    try {
      const text = await extractTextFromPDF(file);
      const result = await withRetry(() => analyzeDocument(text, type, customName));

      setData(prev => {
        const newData = { ...prev };
        if (type === 'master') newData.masterData = result;
        if (type === 'signatories') newData.signatories = result;
        if (type === 'charges') {
          newData.charges = [...prev.charges, ...result];
          newData.chgFileCount = prev.chgFileCount + 1;
        }
        if (type === 'financials') newData.financials = result;
        if (type === 'other' && customName) {
          newData.otherDocuments = { ...prev.otherDocuments, [customName]: result.summary };
        }
        return newData;
      });
      if (type === 'other') setCustomDocName('');
    } catch (error: any) {
      console.error('Analysis failed:', error);
      const errorMessage = error?.message || 'Unknown error';
      if (type === 'charges') {
        setData(prev => ({
          ...prev,
          chgFileCount: prev.chgFileCount + 1,
          failedDocuments: [...prev.failedDocuments, { name: file.name, error: errorMessage }]
        }));
      }
      alert(`Failed to analyze document: ${errorMessage}. Please check your internet connection and try again.`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setAnalysisProgress({ current: 0, total: files.length, fileName: 'Starting...' });
    setIsAnalyzing(true);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setAnalysisProgress({ current: i + 1, total: files.length, fileName: file.name });
      try {
        const text = await extractTextFromPDF(file);
        const category = await classifyDocument(text);
        const result = await analyzeDocument(text, category, file.name);

        setData(prev => {
          const newData = { ...prev };
          if (category === 'master') newData.masterData = result;
          if (category === 'signatories') newData.signatories = result;
          if (category === 'charges') {
            newData.charges = [...prev.charges, ...result];
            newData.chgFileCount = prev.chgFileCount + 1;
          }
          if (category === 'financials') newData.financials = result;
          if (category === 'other') {
            newData.otherDocuments = { ...prev.otherDocuments, [file.name]: result.summary };
          }
          return newData;
        });

        // Add a small delay between files to avoid rate limits
        if (i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      } catch (error: any) {
        console.error(`Failed to process ${file.name}:`, error);
        const errorMessage = error?.message || 'Unknown error';
        // If it looks like a CHG file, count it as failed charge file
        if (file.name.toUpperCase().includes('CHG')) {
          setData(prev => ({
            ...prev,
            chgFileCount: prev.chgFileCount + 1,
            failedDocuments: [...prev.failedDocuments, { name: file.name, error: errorMessage }]
          }));
        }
      }
    }

    setAnalysisProgress(null);
    setIsAnalyzing(false);
  };

  const handleSRNSubmit = () => {
    const srns = srnInput.split(/[\s,]+/).filter(s => s.trim().length > 0);
    setData(prev => ({ ...prev, rawSRNs: srns }));
    setSrnInput('');
  };

  const generateReport = async () => {
    setIsDownloading(true);
    try {
      const html = await generateFinalReport(data);
      setReport(html);
      
      // Use a small timeout to ensure the DOM has updated with the report content
      setTimeout(async () => {
        await handleExport();
      }, 1000);
    } catch (error) {
      console.error('Report generation failed:', error);
      alert('Failed to generate report content. Please try again.');
      setIsDownloading(false);
    }
  };

  const handleExport = async () => {
    const element = document.getElementById('report-content');
    if (!element) return;

    try {
      setIsDownloading(true);
      
      const opt = {
        margin: [0, 0, 0, 0] as [number, number, number, number], // Margins are handled by CSS padding: 1in
        filename: `ROC_Report_${data.masterData?.companyName || 'Company'}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { 
          scale: 2, 
          useCORS: true, 
          letterRendering: true,
          scrollY: 0
        },
        jsPDF: { unit: 'in' as const, format: 'a4' as const, orientation: 'portrait' as const },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] as any }
      };

      // Generate PDF with page numbers and headers
      const worker = html2pdf().set(opt).from(element).toPdf().get('pdf').then((pdf: any) => {
        const totalPages = pdf.internal.getNumberOfPages();
        const companyName = data.masterData?.companyName || 'Company';
        
        for (let i = 1; i <= totalPages; i++) {
          pdf.setPage(i);
          
          // Header
          pdf.setFontSize(9);
          pdf.setTextColor(150);
          pdf.text(
            `ROC Search & Status Report - ${companyName}`,
            pdf.internal.pageSize.getWidth() / 2,
            0.4,
            { align: 'center' }
          );
          
          // Footer
          pdf.setFontSize(10);
          pdf.setTextColor(100);
          pdf.text(
            `Page ${i} of ${totalPages}`, 
            pdf.internal.pageSize.getWidth() / 2, 
            pdf.internal.pageSize.getHeight() - 0.5, 
            { align: 'center' }
          );
        }
      });
      
      await (worker as any).save();
      
      setIsDownloading(false);
    } catch (error) {
      console.error('PDF generation failed:', error);
      alert('Failed to generate PDF. Please try again.');
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-[#1E293B] font-sans overflow-hidden">
      {/* Left Sidebar */}
      <aside className="w-80 bg-[#0F172A] text-white flex flex-col border-r border-[#1E293B]">
        <div className="p-6 border-b border-[#1E293B]">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <FileCheck className="text-[#38BDF8]" />
            Compliance Analyzer
          </h1>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest font-semibold">MCA Search Report Tool</p>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          <div className="space-y-6">
            <div>
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 px-2">Navigation</h3>
              <div className="space-y-1">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as TabType)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      activeTab === tab.id ? "bg-sky-500 text-white shadow-lg shadow-sky-500/20" : "text-slate-400 hover:text-white hover:bg-slate-800"
                    )}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-[#1E293B]">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
            <p className="text-[10px] text-slate-400 uppercase font-bold mb-2">Firm Details</p>
            <p className="text-sm font-bold">Girdhar & Co.</p>
            <p className="text-[10px] text-slate-500">Chartered Accountants</p>
          </div>
        </div>
      </aside>

      {/* Center Panel */}
      <main className="flex-1 flex flex-col bg-white border-r border-slate-200 overflow-hidden">
        <header className="p-6 border-b border-slate-100 flex justify-between items-center bg-white z-10">
          <div>
            <h2 className="text-2xl font-bold text-[#0F172A]">Document Uploads</h2>
            <p className="text-sm text-slate-500">Upload specific documents or use bulk upload below</p>
          </div>
          <div className="flex items-center gap-4">
            <label className="relative cursor-pointer bg-[#0F172A] text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-slate-900/20 hover:bg-slate-800 flex items-center gap-2">
              <Upload className="w-4 h-4 text-sky-400" />
              Bulk Upload
              <input
                type="file"
                multiple
                accept=".pdf"
                onChange={handleBulkUpload}
                className="hidden"
              />
            </label>
            {isAnalyzing && (
              <div className="flex items-center gap-2 text-sky-600 font-medium animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin" />
                {analysisProgress 
                  ? (
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-slate-400 truncate max-w-[150px]">{analysisProgress.fileName}</span>
                      <span>Processing {analysisProgress.current}/{analysisProgress.total}...</span>
                    </div>
                  )
                  : 'Analyzing PDF...'}
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/30">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Standard Upload Sections */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {TABS.map((tab) => (
                <div 
                  key={tab.id} 
                  className={cn(
                    "p-5 rounded-2xl border transition-all bg-white shadow-sm",
                    activeTab === tab.id ? "border-sky-200 ring-1 ring-sky-200" : "border-slate-100"
                  )}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2 rounded-xl", activeTab === tab.id ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-400")}>
                        <tab.icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-[#0F172A] text-sm">{tab.label}</h3>
                        <p className="text-[10px] text-slate-500">{tab.description}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge active={
                        (tab.id === 'master' && !!data.masterData) ||
                        (tab.id === 'signatories' && data.signatories.length > 0) ||
                        (tab.id === 'charges' && data.charges.length > 0) ||
                        (tab.id === 'financials' && !!data.financials)
                      } />
                      {tab.id === 'charges' && data.chgFileCount > 0 && (
                        <span className="text-[9px] font-bold text-slate-400">
                          {data.chgFileCount} Files Processed
                        </span>
                      )}
                    </div>
                  </div>
                  <label className="w-full relative cursor-pointer bg-slate-50 border border-slate-200 hover:border-sky-500 text-[#0F172A] px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2">
                    <Upload className="w-3 h-3 text-sky-500" />
                    Upload PDF
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => handleFileUpload(e, tab.id as TabType)}
                      className="hidden"
                    />
                  </label>
                  {tab.id === 'charges' && data.failedDocuments.length > 0 && (
                    <div className="mt-3 p-2 bg-rose-50 border border-rose-100 rounded-lg">
                      <p className="text-[9px] font-bold text-rose-600 uppercase mb-1 flex items-center gap-1">
                        <AlertCircle className="w-2 h-2" />
                        Failed to extract:
                      </p>
                      <ul className="text-[9px] text-rose-500 space-y-1">
                        {data.failedDocuments.map((doc, i) => (
                          <li key={i} className="flex flex-col">
                            <span className="font-bold">{doc.name}</span>
                            <span className="opacity-70 italic">{doc.error}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* SRN Input Section */}
            {data.charges.length > 0 && (
              <div className="p-6 rounded-2xl border border-slate-100 bg-white shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">SRN Verification</h4>
                  <span className="text-[10px] text-sky-600 font-bold bg-sky-50 px-2 py-1 rounded-lg">{data.rawSRNs.length} SRNs listed</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={srnInput}
                    onChange={(e) => setSrnInput(e.target.value)}
                    placeholder="Add SRNs (comma separated)"
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  />
                  <button
                    onClick={handleSRNSubmit}
                    className="bg-[#0F172A] text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-slate-800 transition-all"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {/* Any Other Documents Section */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-white shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-xl bg-slate-100 text-slate-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-[#0F172A] text-sm">Any other documents?</h3>
                  <p className="text-[10px] text-slate-500">Upload additional ROC filings or resolutions</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customDocName}
                    onChange={(e) => setCustomDocName(e.target.value)}
                    placeholder="Document category name (e.g. Board Resolution)"
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  />
                  <label className={cn(
                    "relative cursor-pointer bg-[#0F172A] text-white px-6 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
                    !customDocName && "opacity-50 cursor-not-allowed"
                  )}>
                    <Upload className="w-4 h-4" />
                    Upload
                    <input
                      type="file"
                      accept=".pdf"
                      disabled={!customDocName}
                      onChange={(e) => handleFileUpload(e, 'other', customDocName)}
                      className="hidden"
                    />
                  </label>
                </div>
                
                {Object.keys(data.otherDocuments).length > 0 && (
                  <div className="pt-4 space-y-2">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Added Documents</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.keys(data.otherDocuments).map((name) => (
                        <div key={name} className="bg-sky-50 border border-sky-100 px-3 py-1.5 rounded-xl text-xs font-medium text-sky-700 flex items-center gap-2">
                          <FileCheck className="w-3 h-3 text-sky-500" />
                          {name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* On-screen Preview Section */}
            {(data.masterData || data.signatories.length > 0 || data.charges.length > 0) && (
              <div className="space-y-8 pt-8 border-t border-slate-200">
                <div className="flex items-center gap-4">
                  <div className="h-px flex-1 bg-slate-200"></div>
                  <h3 className="text-lg font-black text-[#0F172A] uppercase tracking-tighter">Report Preview</h3>
                  <div className="h-px flex-1 bg-slate-200"></div>
                </div>

                {/* 1. Master Data */}
                {data.masterData && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="preview-badge">1</div>
                      <h4 className="preview-section-title">Company Master Data</h4>
                    </div>
                    <div className="preview-card grid grid-cols-1 md:grid-cols-2 gap-6">
                      <DataField label="Company Name" value={data.masterData.companyName} bold />
                      <DataField label="CIN" value={data.masterData.cin} />
                      <DataField label="Registration Date" value={data.masterData.registrationDate} />
                      <DataField label="Status" value={data.masterData.companyStatus} status />
                      <DataField label="Authorized Capital" value={data.masterData.authorizedCapital} money />
                      <DataField label="Paid-up Capital" value={data.masterData.paidUpCapital} money />
                      <DataField label="Date of Last AGM" value={data.masterData.lastAgmDate} />
                      <DataField label="Date of Last Balance Sheet" value={data.masterData.lastBalanceSheetDate} />
                      <DataField label="Annual Compliance Status" value={data.masterData.activeCompliance} status />
                      <div className="md:col-span-2">
                        <DataField label="Registered Address" value={data.masterData.registeredAddress} />
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Signatory Details */}
                {data.signatories.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="preview-badge">2</div>
                      <h4 className="preview-section-title">Signatory Details</h4>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                      {data.signatories.map((s, idx) => (
                        <div key={idx} className="preview-card space-y-4">
                          <div className="flex justify-between items-start">
                            <DataField label="Director Name" value={s.name} bold />
                            <div className="text-[10px] font-bold text-slate-400">DIN: {s.din}</div>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <DataField label="Designation" value={s.designation} />
                            <DataField label="Appt. Date" value={s.appointmentDate} />
                            <DataField label="Remuneration" value={s.remuneration || 'As per Board'} money />
                            <DataField label="Disqualification" value={s.disqualificationStatus || 'None'} />
                          </div>
                          {s.otherDirectorships && s.otherDirectorships.length > 0 && (
                            <div className="pt-4 border-t border-slate-200">
                              <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Other Directorships</p>
                              <div className="flex flex-wrap gap-2">
                                {s.otherDirectorships.map((od, i) => (
                                  <div key={i} className="bg-white px-3 py-1.5 rounded-lg text-[10px] border border-slate-200">
                                    <span className="font-bold">{od.companyName}</span>
                                    <span className={cn("ml-2", od.status === 'Active' ? 'text-emerald-500' : 'text-rose-500')}>({od.status})</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. Charge Documents */}
                {data.charges.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="preview-badge">3</div>
                      <h4 className="preview-section-title">Charge Documents</h4>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                      {data.charges.map((c, idx) => (
                        <div key={idx} className={cn("preview-card space-y-4", c.fileReadError && "border-rose-200 bg-rose-50/30")}>
                          {c.fileReadError ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-rose-600 font-bold text-sm">
                                <AlertCircle className="w-4 h-4" />
                                {c.holderName}
                              </div>
                              <p className="text-xs text-rose-500 italic">{c.errorReason}</p>
                              <p className="text-[10px] text-slate-500">{c.propertyDescription}</p>
                            </div>
                          ) : (
                            <>
                              <div className="flex justify-between items-start">
                                <DataField label="Charge Holder" value={c.holderName} bold />
                                <div className="text-[10px] font-bold text-slate-400">ID: {c.chargeId}</div>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <DataField label="Amount Secured" value={c.amountSecured || c.amount} money />
                                <DataField label="Nature of Charge" value={c.natureOfCharge || 'N/A'} />
                                <DataField label="Creation Date" value={c.dateOfCreation} />
                                <DataField label="Modification Date" value={c.dateOfModification || 'N/A'} />
                              </div>
                              <DataField label="Property Description" value={c.propertyDescription} />
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <DataField label="Margin" value={c.margin || 'N/A'} />
                                <DataField label="Terms of Repayment" value={c.termsOfRepayment || 'N/A'} />
                                <DataField label="Extent & Operation" value={c.extentAndOperation || 'N/A'} />
                              </div>
                              <DataField label="Terms & Conditions" value={c.termsAndConditions || 'N/A'} />
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. Financial Compliance */}
                {data.financials && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="preview-badge">4</div>
                      <h4 className="preview-section-title">Financial Compliance</h4>
                    </div>
                    <div className="preview-card grid grid-cols-2 md:grid-cols-4 gap-6">
                      <DataField label="Compliance Status" value={data.financials.complianceStatus} status />
                      <DataField label="Industry Code" value={data.financials.industryCode} />
                      <DataField label="Last AGM Date" value={data.financials.lastAgmDate} />
                      <DataField label="Balance Sheet Date" value={data.financials.lastBalanceSheetDate} />
                      <div className="col-span-full pt-4 border-t border-slate-200">
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">List of SRNs</p>
                        <div className="flex flex-wrap gap-2">
                          {data.rawSRNs.map((srn, i) => (
                            <span key={i} className="bg-white px-2 py-1 rounded border border-slate-200 text-[10px] font-mono">{srn}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. Other Documents */}
                {Object.keys(data.otherDocuments).length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="preview-badge">5</div>
                      <h4 className="preview-section-title">Other Documents</h4>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                      {Object.entries(data.otherDocuments).map(([name, summary], idx) => (
                        <div key={idx} className="preview-card">
                          <DataField label={name} value={summary} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Generate Report Button */}
            <div className="pt-12">
              <button
                onClick={generateReport}
                disabled={isAnalyzing || isDownloading || !data.masterData}
                className="w-full bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white font-black py-5 px-8 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-2xl shadow-slate-900/40 active:scale-[0.98] uppercase tracking-widest text-sm"
              >
                {isAnalyzing || isDownloading ? (
                  <>
                    <Loader2 className="animate-spin w-5 h-5" />
                    {isDownloading ? "Formatting Final PDF..." : "Analyzing Data..."}
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5 text-sky-400" />
                    Generate & Download Final Report
                  </>
                )}
              </button>
              {!data.masterData && (
                <p className="text-center text-[10px] text-slate-400 mt-4 font-bold uppercase tracking-widest">
                  Upload Master Data to enable report generation
                </p>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Hidden Report Content for PDF Generation */}
      <div className="fixed top-0 left-0 -z-50 opacity-0 pointer-events-none overflow-hidden" style={{ width: '800px' }}>
        <div id="report-content" className="report-container">
          {report && <div dangerouslySetInnerHTML={{ __html: report }} />}
        </div>
      </div>
    </div>
  );
}

function DataField({ label, value, bold, money, status }: { label: string, value: any, bold?: boolean, money?: boolean, status?: boolean }) {
  const isStruck = value?.toString().toLowerCase().includes('struck') || value?.toString().toLowerCase().includes('disqualified');
  const isActive = value?.toString().toLowerCase().includes('active') || value?.toString().toLowerCase().includes('compliant');

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={cn(
        "text-sm leading-relaxed",
        bold ? "font-black text-[#0F172A]" : "text-slate-700",
        money && "money-indigo",
        status && isActive && "status-active",
        status && isStruck && "status-struck"
      )}>
        {value || '–'}
      </p>
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <div className="bg-emerald-50 text-emerald-600 text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-1 border border-emerald-100">
      <FileCheck className="w-3 h-3" />
      Ready
    </div>
  ) : (
    <div className="bg-slate-50 text-slate-400 text-[10px] font-bold px-2 py-1 rounded-lg border border-slate-100">
      Pending
    </div>
  );
}
