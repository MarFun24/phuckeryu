/**
 * POST /api/purchase
 * 
 * Processes a purchase by:
 * 1. Exporting the design as PDF
 * 2. Returning the download URL
 */

// ===========================================
// CANVA API HELPER
// ===========================================
class CanvaAPI {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseUrl = 'https://api.canva.com/rest/v1';
  }

  async request(method, endpoint, body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Canva API Error:', response.status, error);
      throw new Error(`Canva API Error: ${response.status} - ${error.message || JSON.stringify(error)}`);
    }
    
    return response.json();
  }

  /**
   * Start an export job
   */
  async createExportJob(designId, format = 'pdf', pages = null) {
    const body = {
      design_id: designId,
      format: {
        type: format,
      },
    };
    
    if (pages && pages.length > 0) {
      body.format.pages = pages;
    }
    
    return this.request('POST', '/exports', body);
  }

  /**
   * Get export job status
   */
  async getExportJob(jobId) {
    return this.request('GET', `/exports/${jobId}`);
  }
}

// ===========================================
// HANDLER
// ===========================================
export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { designId, pageNumber, tier, format = 'pdf' } = req.body;

    // Validate input
    if (!designId) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'designId is required',
      });
    }

    // Check for Canva API token
    const accessToken = process.env.CANVA_ACCESS_TOKEN;
    if (!accessToken) {
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'Canva API token not configured',
      });
    }

    const canva = new CanvaAPI(accessToken);

    // Determine export format based on tier
    let exportFormat = 'pdf';
    if (tier === 'digital') {
      exportFormat = 'pdf';
    } else if (tier === 'printed' || tier === 'framed') {
      exportFormat = 'pdf'; // High-res PDF for printing
    }

    // Start export job
    console.log(`Starting export for design ${designId}, page ${pageNumber}, format ${exportFormat}`);
    const exportJob = await canva.createExportJob(
      designId,
      exportFormat,
      pageNumber ? [pageNumber] : null
    );

    // Poll for completion
    let result;
    for (let i = 0; i < 60; i++) { // Up to 60 seconds for export
      await new Promise(resolve => setTimeout(resolve, 1000));
      const job = await canva.getExportJob(exportJob.job.id);
      
      if (job.job.status === 'success') {
        result = job.job.result;
        break;
      } else if (job.job.status === 'failed') {
        throw new Error(`Export failed: ${job.job.error?.message || 'Unknown error'}`);
      }
    }

    if (!result) {
      throw new Error('Export timed out');
    }

    // Generate order number
    const orderNumber = generateOrderNumber();

    // Return success with download URL
    res.status(200).json({
      success: true,
      downloadUrl: result.url,
      orderNumber: orderNumber,
      designId: designId,
      format: exportFormat,
    });

  } catch (error) {
    console.error('Purchase/export error:', error);
    res.status(500).json({
      error: 'Failed to process purchase',
      message: error.message,
    });
  }
}

// ===========================================
// HELPERS
// ===========================================
function generateOrderNumber() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'PHU-2025-';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
