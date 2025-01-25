const axios = require('axios');

const pixupConfig = {
  baseUrl: 'https://api.pixupbr.com/v2',
  credentials: {
    clientId: process.env.PIXUP_API_USER,
    clientSecret: process.env.PIXUP_API_SECRET
  },

  async getAccessToken() {
    try {
      const basicToken = Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString('base64');

      const response = await axios.post(`${this.baseUrl}/oauth/token`, 
        {
          grant_type: 'client_credentials'
        },
        {
          headers: {
            'Authorization': `Basic ${basicToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      return response.data.access_token;
    } catch (error) {
      console.error('Erro ao obter token:', error.response?.data || error.message);
      throw error;
    }
  },

  makeRequest: async function(path, method, data = null) {
    try {
      const accessToken = await this.getAccessToken();
      
      const config = {
        method,
        url: `${this.baseUrl}${path}`,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        }
      };

      if (data) {
        config.data = data;
      }

      console.log('Requisição Pixup:', {
        method,
        url: config.url,
        headers: config.headers,
        data: config.data
      });

      const response = await axios(config);
      console.log('Resposta Pixup:', response.data);
      
      return response.data;
    } catch (error) {
      console.error('Erro na requisição Pixup:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      throw error;
    }
  }
};

module.exports = pixupConfig; 