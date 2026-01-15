/**
 * POST /api/preview
 * 
 * Generates a preview by:
 * 1. Creating a copy of the master Canva template
 * 2. Updating text fields with user data
 * 3. Returning the thumbnail URL
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
   * Create autofill job from brand template
   */
  async createAutofillJob(brandTemplateId, data) {
    return this.request('POST', '/autofill/create', {
      brand_template_id: brandTemplateId,
      data: data,
    });
  }

  /**
   * Get autofill job status
   */
  async getAutofillJob(jobId) {
    return this.request('GET', `/autofill/jobs/${jobId}`);
  }

  /**
   * Get design details including thumbnail
   */
  async getDesign(designId) {
    return this.request('GET', `/designs/${designId}`);
  }

  /**
   * Get design pages with thumbnails
   */
  async getDesignPages(designId, offset = 0, limit = 1) {
    return this.request('GET', `/designs/${designId}/pages?offset=${offset}&limit=${limit}`);
  }
}

// ===========================================
// STORAGE (Replace with Redis in production)
// ===========================================
// Note: This in-memory storage won't persist between function invocations!
// For production, use Upstash Redis or similar.
// For now, we'll store the design ID in the response and client will send it back.

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
    const { templateId, pageNumber, fields, existingDesignId } = req.body;

    // Validate input
    if (!templateId || !fields) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'templateId and fields are required',
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

    let designId;
    let thumbnailUrl;

    // If we have an existing design, we could update it
    // But Canva's API may not support direct text updates easily
    // So we'll create a new autofill each time for now
    
    // Prepare autofill data
    // The data structure depends on how you've set up your brand template
    const autofillData = {};
    
    // Map our placeholder format to Canva's autofill format
    // Canva autofill uses dataset names, not placeholder text
    // You'll need to configure these in your brand template
    if (fields['{{RECIPIENT_NAME}}']) {
      autofillData['recipient_name'] = { type: 'text', text: fields['{{RECIPIENT_NAME}}'] };
    }
    if (fields['{{DEGREE_TITLE}}']) {
      autofillData['degree_title'] = { type: 'text', text: fields['{{DEGREE_TITLE}}'] };
    }
    if (fields['{{ACHIEVEMENT_TEXT}}']) {
      autofillData['achievement_text'] = { type: 'text', text: fields['{{ACHIEVEMENT_TEXT}}'] };
    }

    // Create autofill job
    console.log('Creating autofill job with data:', autofillData);
    const autofillJob = await canva.createAutofillJob(templateId, autofillData);
    
    // Poll for completion
    let job;
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      job = await canva.getAutofillJob(autofillJob.job.id);
      
      if (job.job.status === 'success') {
        designId = job.job.result.design.id;
        break;
      } else if (job.job.status === 'failed') {
        throw new Error(`Autofill failed: ${job.job.error?.message || 'Unknown error'}`);
      }
    }

    if (!designId) {
      throw new Error('Autofill timed out');
    }

    // Get the thumbnail for the requested page
    const pages = await canva.getDesignPages(designId, pageNumber - 1, 1);
    
    if (pages.items && pages.items.length > 0) {
      thumbnailUrl = pages.items[0].thumbnail.url;
    } else {
      // Fallback to design thumbnail
      const design = await canva.getDesign(designId);
      thumbnailUrl = design.design.thumbnail.url;
    }

    // Return success
    res.status(200).json({
      success: true,
      designId: designId,
      thumbnailUrl: thumbnailUrl,
      pageNumber: pageNumber,
    });

  } catch (error) {
    console.error('Preview generation error:', error);
    res.status(500).json({
      error: 'Failed to generate preview',
      message: error.message,
    });
  }
}
