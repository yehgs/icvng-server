const passwordRecoveryTemplate = ({ name, otp, recoveryUrl, generatedBy }) => {
  return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Recovery - I-COFFEE.NG</title>
          <style> 
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #4169E1, #0000CD); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
              .footer { background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
              .otp-box { background: white; border: 3px solid #4169E1; padding: 20px; margin: 20px 0; border-radius: 8px; text-align: center; }
              .otp-code { font-size: 24px; font-weight: bold; color: #4169E1; letter-spacing: 3px; margin: 10px 0; }
              .button { display: inline-block; background: #4169E1; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
              .info { background: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 5px; margin: 15px 0; color: #0c5460; }
          </style>
      </head>
      <body>
          <div class="header">
              <h1>🔓 Password Recovery</h1>
              <p>I-COFFEE.NG Account Recovery</p>
          </div>
          
          <div class="content">
              <h2>Hello ${name},</h2>
              <p>A password recovery request has been initiated for your account by <strong>${generatedBy}</strong>.</p>
              
              <div class="otp-box">
                  <h3>🔐 Your Recovery Code</h3>
                  <div class="otp-code">${otp}</div>
                  <p><small>This code is valid for 24 hours</small></p>
              </div>
              
              <p>You can use either method below to recover your account:</p>
              
              <h3>Method 1: Use Recovery Link</h3>
              <a href="${recoveryUrl}" class="button">Reset Password Now</a>
              
              <h3>Method 2: Manual Entry</h3>
              <ol>
                  <li>Go to the password reset page</li>
                  <li>Enter your email address</li>
                  <li>Enter the recovery code: <strong>${otp}</strong></li>
                  <li>Create your new password</li>
              </ol>
              
              <div class="info">
                  <strong>ℹ️ Important Information</strong><br>
                  • This recovery code expires in 24 hours<br>
                  • You can only use this code once<br>
                  • If you didn't request this, contact IT support immediately
              </div>
              
              <p>For security reasons, please change your password as soon as possible and avoid using easily guessable passwords.</p>
              
              <p>Best regards,<br>
              <strong>I-COFFEE.NG Support Team</strong></p>
          </div>
          
          <div class="footer">
              <p>&copy; 2025 I-COFFEE.NG - Premium Coffee Management Solutions</p>
              <p>If you have any questions, contact our support team.</p>
          </div>
      </body>
      </html>
    `;
};

export default passwordRecoveryTemplate;
