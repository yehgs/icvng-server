const passwordResetTemplate = ({ name, newPassword, resetBy }) => {
  return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset - I-COFFEE.NG</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #DC143C, #8B0000); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
              .footer { background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
              .credentials { background: white; border: 2px solid #DC143C; padding: 20px; margin: 20px 0; border-radius: 8px; }
              .warning { background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 5px; margin: 15px 0; color: #721c24; }
          </style>
      </head>
      <body>
          <div class="header">
              <h1>🔐 Password Reset</h1>
              <p>I-COFFEE.NG Security Notice</p>
          </div>
          
          <div class="content">
              <h2>Hello ${name},</h2>
              <p>Your password has been reset by <strong>${resetBy}</strong> from our administration team.</p>
              
              <div class="credentials">
                  <h3>🔑 Your New Temporary Password</h3>
                  <p><strong>New Password:</strong> <code style="background: #f1f1f1; padding: 2px 6px; border-radius: 3px;">${newPassword}</code></p>
              </div>
              
              <div class="warning">
                  <strong>🚨 Security Alert</strong><br>
                  For your security, please log in and change this temporary password immediately. Your previous sessions have been terminated.
              </div>
              
              <h3>Next Steps:</h3>
              <ol>
                  <li>Log in using your new temporary password</li>
                  <li>Navigate to your profile settings</li>
                  <li>Change your password to something secure and memorable</li>
                  <li>Update your security preferences if needed</li>
              </ol>
              
              <p><strong>If you did not request this password reset, please contact IT support immediately.</strong></p>
              
              <p>Best regards,<br>
              <strong>I-COFFEE.NG Security Team</strong></p>
          </div>
          
          <div class="footer">
              <p>&copy; 2025 I-COFFEE.NG - Premium Coffee Management Solutions</p>
              <p>This is an automated security message, please do not reply directly to this email.</p>
          </div>
      </body>
      </html>
    `;
};

export default passwordResetTemplate;
