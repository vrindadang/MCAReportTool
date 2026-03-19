import * as pdfjsLib from 'pdfjs-dist';

// Set worker source using unpkg which is more reliable for pdfjs-dist v5
// Note: v5 uses .mjs for the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ 
    data: arrayBuffer,
    enableXfa: true // Enable XFA support for dynamic forms
  }).promise;
  let fullText = '';

  // Extract standard text content
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    fullText += pageText + '\n';
  }

  // Check for XFA (XML Forms Architecture) data
  try {
    const xfa = await (pdf as any).getXfa();
    if (xfa) {
      // XFA is often a map of XML strings. We'll join them all.
      let xfaText = '';
      
      // In version 5, the data is often in the 'datasets' property
      if (xfa.datasets) {
        for (const key in xfa.datasets) {
          if (typeof xfa.datasets[key] === 'string') {
            xfaText += `\n--- XFA Dataset (${key}) ---\n${xfa.datasets[key]}\n`;
          }
        }
      } else {
        // Fallback to iterating the whole object
        for (const key in xfa) {
          if (typeof xfa[key] === 'string') {
            xfaText += `\n--- XFA Data (${key}) ---\n${xfa[key]}\n`;
          }
        }
      }
      
      if (xfaText) {
        fullText += "\n\n[XFA FORM DATA DETECTED]\n" + xfaText;
      }
    }
  } catch (e) {
    console.warn('Failed to extract XFA data:', e);
  }

  return fullText;
}
