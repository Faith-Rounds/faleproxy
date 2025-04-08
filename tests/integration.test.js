const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const { sampleHtmlWithYale } = require('./test-utils');
const nock = require('nock');

// Set a different port for testing to avoid conflict with the main app
const TEST_PORT = 3099;
let server;

describe('Integration Tests', () => {
  beforeAll(async () => {
    // Mock external HTTP requests but allow localhost
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
    nock.enableNetConnect('localhost');
    
    // Create a test app
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Add the same route handler as the main app
    app.post('/fetch', async (req, res) => {
      try {
        const { url } = req.body;
        
        if (!url) {
          return res.status(400).json({ error: 'URL is required' });
        }

        // Fetch the content from the provided URL
        const response = await axios.get(url);
        const html = response.data;

        // Use cheerio to parse HTML and selectively replace text content, not URLs
        const $ = cheerio.load(html);
        
        // Process text nodes in the body
        $('body *').contents().filter(function() {
          return this.nodeType === 3; // Text nodes only
        }).each(function() {
          // Replace text content but not in URLs or attributes
          const text = $(this).text();
          const newText = text
            .replace(/YALE/g, 'FALE')
            .replace(/Yale/g, 'Fale')
            .replace(/yale/g, 'fale');
          if (text !== newText) {
            $(this).replaceWith(newText);
          }
        });
        
        // Process title separately
        const title = $('title').text()
          .replace(/YALE/g, 'FALE')
          .replace(/Yale/g, 'Fale')
          .replace(/yale/g, 'fale');
        $('title').text(title);
        
        return res.json({ 
          success: true, 
          content: $.html(),
          title: title,
          originalUrl: url
        });
      } catch (error) {
        console.error('Error fetching URL:', error.message);
        return res.status(500).json({ 
          error: `Failed to fetch content: ${error.message}` 
        });
      }
    });

    // Start the test server
    return new Promise((resolve) => {
      server = app.listen(TEST_PORT, () => {
        console.log(`Test server started on port ${TEST_PORT}`);
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Close the test server
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    nock.cleanAll();
    nock.enableNetConnect();
  });

  test('Should replace Yale with Fale in fetched content', async () => {
    // Setup mock for example.com
    nock('https://example.com')
      .get('/')
      .reply(200, sampleHtmlWithYale);
    
    try {
      // Make a request to our proxy app
      const response = await axios.post(`http://localhost:${TEST_PORT}/fetch`, {
        url: 'https://example.com/'
      });
      
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      
      // Verify Yale has been replaced with Fale in text
      const $ = cheerio.load(response.data.content);
      expect($('title').text()).toBe('Fale University Test Page');
      expect($('h1').text()).toBe('Welcome to Fale University');
      expect($('p').first().text()).toContain('Fale University is a private');
      
      // Verify URLs remain unchanged
      const links = $('a');
      let hasYaleUrl = false;
      links.each((i, link) => {
        const href = $(link).attr('href');
        if (href && href.includes('yale.edu')) {
          hasYaleUrl = true;
        }
      });
      expect(hasYaleUrl).toBe(true);
      
      // Verify link text is changed
      expect($('a').first().text()).toBe('About Fale');
    } catch (error) {
      console.error('Test error:', error);
      throw error;
    }
  });

  test('Should handle invalid URLs', async () => {
    try {
      await axios.post(`http://localhost:${TEST_PORT}/fetch`, {
        url: 'not-a-valid-url'
      });
      fail('Expected request to fail');
    } catch (error) {
      expect(error.response?.status).toBe(500);
      expect(error.response?.data?.error).toContain('Failed to fetch content');
    }
  });

  test('Should handle missing URL parameter', async () => {
    try {
      await axios.post(`http://localhost:${TEST_PORT}/fetch`, {});
      fail('Expected request to fail');
    } catch (error) {
      expect(error.response?.status).toBe(400);
      expect(error.response?.data?.error).toBe('URL is required');
    }
  });
});
