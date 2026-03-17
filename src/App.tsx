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
  { id: 'charges', label: 'Charge Documents', icon: CreditCard, description: 'Loan amounts, Property descriptions' },
  { id: 'financials', label: 'Financials (AOC-4/MGT-7)', icon: BarChart3, description: 'Compliance status, Industry code' },
] as const;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('master');
  const [data, setData] = useState<ComplianceData>({
    signatories: [],
    charges: [],
    rawSRNs: [],
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
        if (type === 'charges') newData.charges = [...prev.charges, ...result];
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
          if (category === 'charges') newData.charges = [...prev.charges, ...result];
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
      } catch (error) {
        console.error(`Failed to process ${file.name}:`, error);
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
      const md = await generateFinalReport(data);
      setReport(md);
      
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
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
      });

      // Use the html method for vector-based PDF (selectable text, no blur)
      await pdf.html(element, {
        callback: (doc) => {
          doc.save(`Search_Report_${data.masterData?.companyName || 'Company'}.pdf`);
          setIsDownloading(false);
        },
        x: 10,
        y: 10,
        width: 190, // target width in mm
        windowWidth: 1024, // width of the virtual window to render from
      });
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

        <nav className="flex-1 p-4 space-y-2">
          {/* Navigation removed as per user request */}
        </nav>

        <div className="p-4 border-t border-[#1E293B]">
          {/* Button moved to main screen */}
        </div>
      </aside>

      {/* Center Panel */}
      <main className="flex-1 flex flex-col bg-white border-r border-slate-200">
        <header className="p-6 border-b border-slate-100 flex justify-between items-center">
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

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Standard Upload Sections */}
            {TABS.map((tab) => (
              <div 
                key={tab.id} 
                className={cn(
                  "p-6 rounded-3xl border transition-all",
                  activeTab === tab.id ? "bg-sky-50 border-sky-200 ring-1 ring-sky-200" : "bg-slate-50 border-slate-100"
                )}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-xl", activeTab === tab.id ? "bg-sky-500 text-white" : "bg-white text-slate-400 border border-slate-100")}>
                      <tab.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[#0F172A]">{tab.label}</h3>
                      <p className="text-[10px] text-slate-500">{tab.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge active={
                      (tab.id === 'master' && !!data.masterData) ||
                      (tab.id === 'signatories' && data.signatories.length > 0) ||
                      (tab.id === 'charges' && data.charges.length > 0) ||
                      (tab.id === 'financials' && !!data.financials)
                    } />
                    <label className="relative cursor-pointer bg-white border border-slate-200 hover:border-sky-500 text-[#0F172A] px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2">
                      <Upload className="w-3 h-3 text-sky-500" />
                      Upload PDF
                      <input
                        type="file"
                        accept=".pdf"
                        onChange={(e) => handleFileUpload(e, tab.id as TabType)}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
                
                {tab.id === 'charges' && data.charges.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-sky-100">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">SRN Verification</h4>
                      <span className="text-[10px] text-sky-600 font-bold">{data.rawSRNs.length} SRNs listed</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={srnInput}
                        onChange={(e) => setSrnInput(e.target.value)}
                        placeholder="Add SRNs (comma separated)"
                        className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                      />
                      <button
                        onClick={handleSRNSubmit}
                        className="bg-[#0F172A] text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-800"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Any Other Documents Section */}
            <div className="p-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50/50">
              <h3 className="font-bold text-[#0F172A] mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-slate-400" />
                Any other documents?
              </h3>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customDocName}
                    onChange={(e) => setCustomDocName(e.target.value)}
                    placeholder="Document category name (e.g. Board Resolution)"
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20"
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
                        <div key={name} className="bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 flex items-center gap-2">
                          <FileCheck className="w-3 h-3 text-emerald-500" />
                          {name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Ready Documents Summary Section */}
            <div className="p-6 rounded-3xl border border-emerald-100 bg-emerald-50/30">
              <h3 className="font-bold text-[#0F172A] mb-4 flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-emerald-500" />
                Ready Documents Summary
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <SummaryItem label="Master Data" ready={!!data.masterData} />
                  <SummaryItem label="Signatory Details" ready={data.signatories.length > 0} />
                  <SummaryItem label="Charge Documents" ready={data.charges.length > 0} />
                </div>
                <div className="space-y-2">
                  <SummaryItem label="Financials" ready={!!data.financials} />
                  <SummaryItem label="SRNs Added" ready={data.rawSRNs.length > 0} />
                  <SummaryItem label="Other Documents" ready={Object.keys(data.otherDocuments).length > 0} />
                </div>
              </div>
            </div>

            {/* Generate Report Button */}
            <div className="pt-6 border-t border-slate-100">
              <button
                onClick={generateReport}
                disabled={isAnalyzing || isDownloading}
                className="w-full bg-[#38BDF8] hover:bg-[#0EA5E9] disabled:opacity-50 text-white font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-sky-900/20 active:scale-95"
              >
                {isAnalyzing || isDownloading ? (
                  <>
                    <Loader2 className="animate-spin" />
                    {isDownloading ? "Generating PDF..." : "Analyzing..."}
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    Generate & Download Final Report
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Hidden Report Content for PDF Generation */}
      <div className="fixed top-0 left-0 -z-50 opacity-0 pointer-events-none overflow-hidden" style={{ width: '1024px' }}>
        <div id="report-content" className="bg-white p-8 markdown-body">
          {report && <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{report}</Markdown>}
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, ready }: { label: string, ready: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-slate-100 shadow-sm">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {ready ? (
        <div className="flex items-center gap-1 text-emerald-600 font-bold text-[10px]">
          <FileCheck className="w-3 h-3" />
          READY
        </div>
      ) : (
        <span className="text-[10px] text-slate-400 font-bold">MISSING</span>
      )}
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <div className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-1">
      <FileCheck className="w-3 h-3" />
      Ready
    </div>
  ) : (
    <div className="bg-slate-200 text-slate-500 text-[10px] font-bold px-2 py-1 rounded-lg">
      Pending
    </div>
  );
}
