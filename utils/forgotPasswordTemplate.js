const forgotPasswordTemplate = ({ name, otp }) => {
  return `
  <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #4B2E2B; background: linear-gradient(to bottom, #EDE0D4, #F5EBE0); padding: 25px; border-radius: 12px; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
    <div style="text-align: center; margin-bottom: 20px;">
      <img src="https://barattini.coffee/wp-content/uploads/2025/07/web-logo.svg" alt="I-Coffee.ng" width="150" style="margin-bottom: 15px;">
      <h2 style="color: #4B2E2B; font-weight: 600; margin: 10px 0; font-size: 24px;">Password Reset Request</h2>
    </div>
    
    <div style="background: white; border-radius: 8px; padding: 25px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.04);">
      <p style="font-size: 16px; line-height: 1.6;">Dear ${name},</p>
      
      <p style="font-size: 16px; line-height: 1.6; margin: 15px 0;">You requested a password reset. Use the following OTP code to reset your password:</p>
      
      <div style="background: linear-gradient(to right, #8D7B68, #C69C6D); font-size: 26px; padding: 20px; text-align: center; font-weight: bold; border-radius: 8px; color: #FFF; letter-spacing: 5px; margin: 25px 0; box-shadow: 0 3px 6px rgba(0,0,0,0.1);">
        ${otp}
      </div>
      
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 15px;">This OTP is valid for 1 hour only. Enter it on the I-Coffee.ng website to proceed with resetting your password.</p>
      
      <p style="font-size: 14px; color: #666; margin-top: 20px; line-height: 1.5;">If you didn't request this, please ignore this email or contact customer support immediately.</p>
    </div>
    
    <div style="border-top: 2px solid #C69C6D; padding-top: 20px; margin-top: 20px;">
      <p style="font-weight: 600; font-size: 16px; margin-bottom: 15px;">Connect with us:</p>
      
      <div style="display: flex; justify-content: center; margin: 15px 0;">
        <a href="https://www.facebook.com/Italiancoffeeonline/?ref=pages_you_manage" style="margin-right: 15px;">
          <img src="https://cdn-icons-png.flaticon.com/512/733/733547.png" alt="Facebook" width="30">
        </a>
        <a href="https://twitter.com/italiancoffee_v" style="margin-right: 15px;">
          <img src="https://cdn-icons-png.flaticon.com/512/733/733579.png" alt="Twitter" width="30">
        </a>
       <a href="https://www.instagram.com/italiancofeeventure/">
          <img src="https://cdn-icons-png.flaticon.com/512/2111/2111463.png" alt="Instagram" width="30">
        </a>
      </div>
      
      <div style="text-align: center; color: #666; font-size: 14px; line-height: 1.6;">
        <p>Need help? Contact us:</p>
        <p>
          <a href="mailto:customercare@i-coffee.ng" style="color: #9B2226; text-decoration: none; font-weight: 600;">customercare@i-coffee.ng</a>
        </p>
        <p>
          <a href="tel:+2348039827194" style="color: #9B2226; text-decoration: none; font-weight: 600;">+234 8039 827194</a>
        </p>
        <p style="margin-top: 10px;">&copy; ${new Date().getFullYear()} I-coffee.ng. All rights reserved.</p>
      </div>
    </div>
  </div>
  `;
};

export default forgotPasswordTemplate;
