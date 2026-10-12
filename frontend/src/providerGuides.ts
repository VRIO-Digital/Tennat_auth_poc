// Step-by-step setup instructions shown in the "How to configure" panel.
// {entity} and {acs} are replaced with this workspace's values.

export type Guide = {
  console: string // where to start
  url: string
  steps: string[]
  idpMap: string // which values to copy back into the form
}

const finish = 'Come back here, click Test connection (a sign-in tab opens), then Save & enable.'

export const GUIDES: Record<string, Guide> = {
  google_workspace: {
    console: 'Google Admin console',
    url: 'https://admin.google.com/ac/apps/unified',
    idpMap: 'SSO URL → Login URL, Entity ID → Identity provider Entity ID, Certificate → X.509 certificate',
    steps: [
      'Sign in to the Google Admin console as a super admin and go to Apps → Web and mobile apps.',
      'Click Add app → Add custom SAML app and give it a name, e.g. “ContextWeave”.',
      'On the “Google Identity Provider details” page copy the SSO URL and Entity ID, and download the Certificate (or copy it). Paste all three into the fields below, then click Continue.',
      'On “Service provider details” paste the ACS URL ({acs}) and the Entity ID ({entity}) from the box above. Leave “Signed response” unticked.',
      'Set Name ID format to EMAIL and Name ID to Basic Information → Primary email. Click Continue, then Finish.',
      'Open the new app → User access → set Service status to ON for everyone (or the right organisational unit) and Save. It can take a few minutes to apply.',
      finish,
    ],
  },
  azure_ad: {
    console: 'Microsoft Entra admin center',
    url: 'https://entra.microsoft.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview',
    idpMap: 'Login URL → Login URL, Microsoft Entra Identifier → Identity provider Entity ID, Certificate (Base64) → X.509 certificate',
    steps: [
      'In the Entra admin center go to Enterprise applications → New application → Create your own application.',
      'Name it, choose “Integrate any other application you don’t find in the gallery (Non-gallery)” and click Create.',
      'Open Single sign-on → SAML, then edit Basic SAML Configuration: set Identifier (Entity ID) to {entity} and Reply URL (ACS) to {acs}. Save.',
      'Under Attributes & Claims make sure the Unique User Identifier (Name ID) is user.mail (or user.userprincipalname) so we receive an email address.',
      'Under SAML Certificates download Certificate (Base64) and paste its contents below.',
      'Under “Set up” copy Login URL and Microsoft Entra Identifier into the fields below.',
      'Go to Users and groups and assign the people who may sign in.',
      finish,
    ],
  },
  okta: {
    console: 'Okta Admin Console',
    url: 'https://login.okta.com/',
    idpMap: 'Sign on URL → Login URL, Issuer → Identity provider Entity ID, Signing certificate → X.509 certificate',
    steps: [
      'In the Okta Admin Console go to Applications → Create App Integration, choose SAML 2.0 and click Next.',
      'Name the app, then on Configure SAML set Single sign-on URL to {acs} and Audience URI (SP Entity ID) to {entity}.',
      'Set Name ID format to EmailAddress and Application username to Email. Click Next, then Finish.',
      'Open the app’s Sign On tab → View SAML setup instructions. Copy the Sign on URL, Issuer and X.509 certificate into the fields below.',
      'Open the Assignments tab and assign the people or groups who may sign in.',
      finish,
    ],
  },
  onelogin: {
    console: 'OneLogin admin portal',
    url: 'https://app.onelogin.com/apps',
    idpMap: 'SAML 2.0 Endpoint (HTTP) → Login URL, Issuer URL → Identity provider Entity ID, X.509 certificate → X.509 certificate',
    steps: [
      'In OneLogin go to Applications → Add App, search for “SAML Custom Connector (Advanced)” and save it.',
      'On the Configuration tab set Audience (EntityID) to {entity} and ACS (Consumer) URL to {acs}. Set ACS URL Validator to the same ACS URL.',
      'Set SAML nameID format to Email and Save.',
      'Open the SSO tab. Copy the SAML 2.0 Endpoint (HTTP) and Issuer URL, then View Details under X.509 Certificate and copy it. Paste all three below.',
      'Use the Access / Users tab to give people access to the app.',
      finish,
    ],
  },
  auth0: {
    console: 'Auth0 dashboard',
    url: 'https://manage.auth0.com/',
    idpMap: 'Identity Provider Login URL → Login URL, Issuer → Identity provider Entity ID, Identity Provider Certificate → X.509 certificate',
    steps: [
      'In Auth0 go to Applications → Create Application (Regular Web Application), then open it and go to the Addons tab → SAML2 Web App.',
      'On Settings set Application Callback URL to {acs}.',
      'In the settings JSON add "audience": "{entity}" and "nameIdentifierProbes": ["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"]. Click Enable.',
      'On the Usage tab copy Identity Provider Login URL and the Issuer, and download the Identity Provider Certificate. Paste them below.',
      'Make sure the connection used by the app has the users who should sign in.',
      finish,
    ],
  },
  saml: {
    console: 'your identity provider',
    url: '',
    idpMap: 'SSO / Login URL → Login URL, Issuer / Entity ID → Identity provider Entity ID, Signing certificate → X.509 certificate',
    steps: [
      'In your identity provider create a new SAML 2.0 application (custom / generic).',
      'Set the SP Entity ID / Audience to {entity} and the ACS / Reply / Consumer URL to {acs}.',
      'Set the Name ID format to Email address so we receive the user’s email. Use HTTP-POST as the binding for the response.',
      'Copy the identity provider’s SSO URL, Entity ID (Issuer) and signing certificate into the fields below.',
      'Assign the people who may sign in to the application.',
      finish,
    ],
  },
}
