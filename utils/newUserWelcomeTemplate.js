const newUserWelcomeTemplate = ({
  name,
  email,
  password,
  role,
  subRole,
  createdBy,
}) => {
  return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to I-COFFEE.NG</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #8B4513, #D2691E); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
              .footer { background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; }
              .credentials { background: white; border: 2px solid #8B4513; padding: 20px; margin: 20px 0; border-radius: 8px; }
              .button { display: inline-block; background: #8B4513; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
              .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 15px 0; color: #856404; }
          </style>
      </head>
      <body>
          <div class="header">
              <h1>☕ Welcome to I-COFFEE.NG</h1>
              <p>Your premium coffee management platform</p>
          </div>
          
          <div class="content">
              <h2>Hello ${name}!</h2>
              <p>Welcome to the I-COFFEE.NG team! Your account has been created by <strong>${createdBy}</strong> and you now have access to our management system.</p>
              
              <div class="credentials">
                  <h3>🔐 Your Login Credentials</h3>
                  <p><strong>Email:</strong> ${email}</p>
                  <p><strong>Temporary Password:</strong> <code style="background: #f1f1f1; padding: 2px 6px; border-radius: 3px;">${password}</code></p>
                  <p><strong>Role:</strong> ${role}</p>
                  ${
                    subRole
                      ? `<p><strong>Department:</strong> ${subRole}</p>`
                      : ''
                  }
              </div>
              
              <div class="warning">
                  <strong>⚠️ Important Security Notice</strong><br>
                  Please change your password immediately after your first login for security purposes.
              </div>
              
              <p>Click the button below to access your dashboard:</p>
              <a href="${
                process.env.ADMIN_FRONTEND_URL || 'http://app.i-coffee.ng'
              }" class="button">Access Dashboard</a>
              
              <h3>What's Next?</h3>
              <ul>
                  <li>Log in using your credentials above</li>
                  <li>Complete your profile information</li>
                  <li>Change your temporary password</li>
                  <li>Explore your dashboard and available features</li>
              </ul>
              
              <p>If you have any questions or need assistance, please don't hesitate to contact our IT support team.</p>
              
              <p>Best regards,<br>
              <strong>I-COFFEE.NG Team</strong></p>
          </div>
          
          <div class="footer">
              <p>&copy; 2025 I-COFFEE.NG - Premium Coffee Management Solutions</p>
              <p>This is an automated message, please do not reply directly to this email.</p>
          </div>
      </body>
      </html>
    `;
};

export default newUserWelcomeTemplate;
