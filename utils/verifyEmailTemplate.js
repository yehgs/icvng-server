const verifyEmailTemplate = ({ name, url }) => {
  return `
  <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #4B2E2B; background: linear-gradient(to bottom, #EDE0D4, #F5EBE0); padding: 25px; border-radius: 12px; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
    <div style="text-align: center; margin-bottom: 20px;">
      <img src="https://your-domain.com/coffee-logo.png" alt="Italian Coffee Ventures" width="150" style="margin-bottom: 15px;">
      <h2 style="color: #4B2E2B; font-weight: 600; margin: 10px 0; font-size: 24px;">Welcome, ${name}!</h2>
    </div>
    
    <div style="background: white; border-radius: 8px; padding: 25px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.04);">
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Thank you for registering with Italian Coffee Ventures. Please verify your email address by clicking the button below:</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="display: inline-block; background: #8D7B68; color: #FFF; padding: 14px 30px; font-size: 16px; font-weight: bold; text-decoration: none; border-radius: 6px; transition: all 0.3s ease; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
          Verify Email
        </a>
      </div>
      
      <p style="font-size: 14px; color: #666; line-height: 1.5;">If you didn't request this, you can safely ignore this email.</p>
    </div>
    
    <div style="border-top: 2px solid #C69C6D; padding-top: 20px; margin-top: 20px;">
      <p style="font-weight: 600; font-size: 16px; margin-bottom: 15px;">Connect with us:</p>
      
      <div style="display: flex; justify-content: center; margin: 15px 0;">
        <a href="https://facebook.com/italiancoffee" style="margin-right: 15px;">
          <img src="https://cdn-icons-png.flaticon.com/512/733/733547.png" alt="Facebook" width="30">
        </a>
        <a href="https://twitter.com/italiancoffee" style="margin-right: 15px;">
          <img src="https://cdn-icons-png.flaticon.com/512/733/733579.png" alt="Twitter" width="30">
        </a>
        <a href="https://instagram.com/italiancoffee">
          <img src="https://cdn-icons-png.flaticon.com/512/2111/2111463.png" alt="Instagram" width="30">
        </a>
      </div>
      
      <div style="text-align: center; color: #666; font-size: 14px; line-height: 1.6;">
        <p>Need help? Contact us:</p>
        <p>
          <a href="mailto:customercare@italiancoffee.com" style="color: #9B2226; text-decoration: none; font-weight: 600;">customercare@italiancoffee.com</a>
        </p>
        <p>
          <a href="tel:+2341234567890" style="color: #9B2226; text-decoration: none; font-weight: 600;">+234 123 456 7890</a>
        </p>
        <p>&copy; ${new Date().getFullYear()} Italian Coffee Ventures. All rights reserved.</p>
      </div>
    </div>
  </div>
  `;
};

export default verifyEmailTemplate;
