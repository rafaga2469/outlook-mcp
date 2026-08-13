/**
 * Send email functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

/**
 * Send email handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleSendEmail(args) {
  const {
    to,
    cc,
    bcc,
    subject,
    body,
    importance = 'normal',
    saveToSentItems = true,
    isHtml,
    replyToId,
  } = args;

  // Validate required parameters
  if (!replyToId && !to) {
    return {
      content: [
        {
          type: 'text',
          text: 'Recipient (to) is required.',
        },
      ],
    };
  }

  if (!replyToId && !subject) {
    return {
      content: [
        {
          type: 'text',
          text: 'Subject is required.',
        },
      ],
    };
  }

  if (!body) {
    return {
      content: [
        {
          type: 'text',
          text: 'Body content is required.',
        },
      ],
    };
  }

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Determine content type: explicit isHtml param takes precedence, otherwise auto-detect
    const contentType =
      isHtml === true
        ? 'html'
        : isHtml === false
          ? 'text'
          : body.includes('<html') || body.includes('<HTML')
            ? 'html'
            : 'text';

    if (replyToId) {
      await callGraphAPI(
        accessToken,
        'POST',
        `me/messages/${encodeURIComponent(replyToId)}/reply`,
        {
          message: {
            body: {
              contentType,
              content: body,
            },
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: `Reply sent successfully to the original message!\n\nMessage Length: ${body.length} characters`,
          },
        ],
      };
    }

    // Format recipients
    const toRecipients = to
      ? to.split(',').map((email) => {
          email = email.trim();
          return {
            emailAddress: {
              address: email,
            },
          };
        })
      : [];

    const ccRecipients = cc
      ? cc.split(',').map((email) => {
          email = email.trim();
          return {
            emailAddress: {
              address: email,
            },
          };
        })
      : [];

    const bccRecipients = bcc
      ? bcc.split(',').map((email) => {
          email = email.trim();
          return {
            emailAddress: {
              address: email,
            },
          };
        })
      : [];

    // Prepare email object
    const emailObject = {
      message: {
        subject,
        body: {
          contentType: contentType,
          content: body,
        },
        toRecipients,
        ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
        bccRecipients: bccRecipients.length > 0 ? bccRecipients : undefined,
        importance,
      },
      saveToSentItems,
    };

    // Make API call to send email
    await callGraphAPI(accessToken, 'POST', 'me/sendMail', emailObject);

    return {
      content: [
        {
          type: 'text',
          text: `Email sent successfully!\n\nSubject: ${subject}\nRecipients: ${toRecipients.length}${ccRecipients.length > 0 ? ` + ${ccRecipients.length} CC` : ''}${bccRecipients.length > 0 ? ` + ${bccRecipients.length} BCC` : ''}\nMessage Length: ${body.length} characters`,
        },
      ],
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'authenticate' tool first.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error sending email: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = handleSendEmail;
