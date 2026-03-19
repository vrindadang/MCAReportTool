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
    let xfa: any = null;
    
    // Try different ways to get XFA data depending on pdf.js version
    if (typeof (pdf as any).getXfa === 'function') {
      xfa = await (pdf as any).getXfa();
    } else if ((pdf as any).xfa) {
      xfa = (pdf as any).xfa;
    } else if ((pdf as any).data && (pdf as any).data.xfa) {
      xfa = (pdf as any).data.xfa;
    }

    if (xfa) {
      let xfaText = '';
      
      // The XFA object can be a Map or a plain object
      let datasets: any = null;
      if (xfa instanceof Map) {
        datasets = xfa.get('datasets') || xfa;
      } else {
        datasets = xfa.datasets || xfa;
      }

      if (datasets && typeof datasets === 'object') {
        // If it's a Map, iterate it
        if (datasets instanceof Map) {
          for (const [key, content] of datasets.entries()) {
            if (typeof content === 'string') {
              const truncatedContent = content.length > 10000 
                ? content.substring(0, 10000) + "... [TRUNCATED]" 
                : content;
              xfaText += `\n--- XFA Dataset (${key}) ---\n${truncatedContent}\n`;
            }
          }
        } else {
          // If it's a plain object, iterate keys
          for (const key in datasets) {
            const content = datasets[key];
            if (typeof content === 'string') {
              const truncatedContent = content.length > 10000 
                ? content.substring(0, 10000) + "... [TRUNCATED]" 
                : content;
              xfaText += `\n--- XFA Dataset (${key}) ---\n${truncatedContent}\n`;
            }
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
