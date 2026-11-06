import { test, expect } from '@playwright/test';

/**
 * Generates a valid Australian ABN.
 */
export function generateABN(): string {
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

  while (true) {
    // Generate first 10 digits randomly
    const digits: number[] = Array.from(
      { length: 11 },
      () => Math.floor(Math.random() * 10)
    );

    // Find a first digit that creates a valid checksum
    for (let firstDigit = 1; firstDigit <= 9; firstDigit++) {
      digits[0] = firstDigit;

      const adjusted = [...digits];
      adjusted[0] -= 1;

      const sum = adjusted.reduce(
        (total, digit, index) => total + digit * weights[index],
        0
      );

      if (sum % 89 === 0) {
        return digits.join('');
      }
    }
  }
}

// pick a random  participant type from the list of participant types, and return it as a string
export function getRandomParticipantType(): string {
  const participantTypes = [
    'manufacturer',
    'importer',
    'installer',
    'retailer',
    'aggregator'
  ];

  const randomIndex = Math.floor(
    Math.random() * participantTypes.length
  );

  return participantTypes[randomIndex];
}

// pick a random  state from the list of states, and return it as a string
export function getRandomState(): string {
  const states = [
    'ACT',
    'NSW',
    'NT',
    'QLD',
    'SA',
    'TAS',
    'VIC',
    'WA'
  ];

  const randomIndex = Math.floor(
    Math.random() * states.length
  );

  return states[randomIndex];
}

// pick a post code given a state 
export function getRandomPostCode(state: string): string {
  const postCodes: { [key: string]: string[] } = {
    'ACT': ['2600', '2601', '2602'],
    'NSW': ['2000', '2001', '2002'],
    'NT': ['0800', '0801', '0802'],
    'QLD': ['4000', '4001', '4002'],
    'SA': ['5000', '5001', '5002'],
    'TAS': ['7000', '7001', '7002'],
    'VIC': ['3000', '3001', '3002'],
    'WA': ['6000', '6001', '6002']
  };

  const statePostCodes = postCodes[state];
  if (!statePostCodes) {
    throw new Error(`No post codes available for state: ${state}`);
  }

  const randomIndex = Math.floor(Math.random() * statePostCodes.length);
  return statePostCodes[randomIndex];
}

// pick a suburb given a state and post code, and return it as a string
export function getRandomSuburb(state: string, postCode: string): string {
  const suburbs: { [key: string]: { [key: string]: string[] } } = {
    'ACT': { '2600': ['Canberra'], '2601': ['Canberra'], '2602': ['Canberra'] },
    'NSW': { '2000': ['Sydney'], '2001': ['Sydney'], '2002': ['Sydney'] },
    'NT': { '0800': ['Darwin'], '0801': ['Darwin'], '0802': ['Darwin'] },
    'QLD': { '4000': ['Brisbane'], '4001': ['Brisbane'], '4002': ['Brisbane'] },
    'SA': { '5000': ['Adelaide'], '5001': ['Adelaide'], '5002': ['Adelaide'] },
    'TAS': { '7000': ['Hobart'], '7001': ['Hobart'], '7002': ['Hobart'] },
    'VIC': { '3000': ['Melbourne'], '3001': ['Melbourne'], '3002': ['Melbourne'] },
    'WA': { '6000': ['Perth'], '6001': ['Perth'], '6002': ['Perth'] }
  };


  const stateSuburbs = suburbs[state];      
    if (!stateSuburbs) {
        throw new Error(`No suburbs available for state: ${state}`);
    }

  const suburbList = stateSuburbs[postCode];
    if (!suburbList) {          
        throw new Error(`No suburbs available for state: ${state} and post code: ${postCode}`);
    }                                               

    const randomIndex = Math.floor(Math.random() * suburbList.length);
    return suburbList[randomIndex];
}

// return a random street name and number, as a string
export function getRandomStreetAddress(): string {
  const streetNames = [         
    'Main Street', 'High Street', 'Church Street', 'Station Road', 'Park Road',
    'Victoria Street', 'Green Lane', 'London Road', 'Kings Road', 'Queens Road'
  ];

    const randomStreetName = streetNames[Math.floor(Math.random() * streetNames.length)];

    const randomStreetNumber = Math.floor(Math.random() * 1000) + 1; // Random number between 1 and 1000
    return `${randomStreetNumber} ${randomStreetName}`;

}

// return a random mobile phone number, as a string
export function getRandomMobileNumber(): string {
  const prefix = '04';
  const suffix = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return `${prefix}${suffix}`;
}

// return a a sparce address line 2, as a string, with a 85% chance of being empty
export function getRandomAddressLine2(): string {
  return Math.random() < 0.85 ? '' : `Unit ${Math.floor(Math.random() * 100) + 1}`;
}

test('test setup new applicant', async ({ page }, testInfo) => {
  // Add the login recording to its own page object
  const username = process.env.CERP_USERNAME;
  const password = process.env.CERP_PASSWORD;
  const login_url = process.env.LOGIN_URL;
  const role = "Applicant";
  const unique_id =  Date.now();
  const commit = true;

  if (!username || !password || !login_url) {
    throw new Error('Set CERP_USERNAME, CERP_PASSWORD, and LOGIN_URL before running this test.');
  }

  // Use the destination URL rather than the Outlook Safe Links wrapper.
  await page.goto(login_url);
  await page.getByLabel(/email|username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  
  // Switcher is a sub comoponent of the topbar, maybe add a hover to the topbar to ensure the switcher is visible
  // add hover here to ensure selector for role switch is visible, use locator to find the button by class name
  await page.locator('button.identity-switcher__trigger.topbar__user').hover();
  // select role option
  await page.getByLabel('RoleCER adminCER').selectOption(role);
  // switch role
  await page.getByRole('button', { name: 'Switch' }).click();

  /*
  // Add participant application recording to its own page objectFill all fields in the organisation details form, and submit the form
  // fill legal name field
  await page.getByRole('textbox', { name: 'Legal name' }).click();
  await page.getByRole('textbox', { name: 'Legal name' }).fill(`AUTO abc legal ${unique_id}`);
  //fill optional trading name field
  await page.getByRole('textbox', { name: 'Trading name (optional)' }).click();
  await page.getByRole('textbox', { name: 'Trading name (optional)' }).fill(`abc trading ${unique_id}`);
  //fill ABN field
  await page.getByRole('textbox', { name: 'ABN 11 digits' }).click();
  await page.getByRole('textbox', { name: 'ABN 11 digits' }).fill(generateABN()); 
  // select participant type from dropdown
  // randomly select a participant type from the dropdown, either manufacturer or importer 
  // Add enumaration for participant type, and randomly select one of the options


  const participantType = getRandomParticipantType();
  await page.getByLabel('Participant').selectOption(participantType);

  // fill contact name field
  await page.getByRole('textbox', { name: 'Contact name' }).click();
  await page.getByRole('textbox', { name: 'Contact name' }).fill(`AUTO abc contact ${unique_id}`);
  // fill email field
  await page.getByRole('textbox', { name: 'Email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(`abc.contact.${unique_id}@automated.com`);
  // fill phone field
  await page.getByRole('textbox', { name: 'Phone' }).click();

  await page.getByRole('textbox', { name: 'Phone' }).fill(getRandomMobileNumber());
  // fill address line 1 field
  await page.getByRole('textbox', { name: 'Address line 1' }).click();
  await page.getByRole('textbox', { name: 'Address line 1' }).fill(getRandomStreetAddress());
  // fill address line 2 field
  await page.getByRole('textbox', { name: 'Address line 2 (optional)' }).click();
  await page.getByRole('textbox', { name: 'Address line 2 (optional)' }).fill(getRandomAddressLine2());
  
  const randomState = getRandomState();
  const randomPostCode = getRandomPostCode(randomState);
  const randomSuburb = getRandomSuburb(randomState, randomPostCode);
  // fill suburb field
  await page.getByRole('textbox', { name: 'Suburb' }).click();
    await page.getByRole('textbox', { name: 'Suburb' }).fill(randomSuburb);
  // Select a state from dropdown
 
  await page.getByLabel('StateACTNSWNTQLDSATASVICWA').selectOption(randomState);

  // fill postcode field, ensure it matches state main city
  await page.getByRole('textbox', { name: 'Postcode' }).click();
  await page.getByRole('textbox', { name: 'Postcode' }).fill(randomPostCode);

  // Declarations
  await page.getByRole('checkbox', { name: 'I am authorised to apply on' }).check();
  await page.getByRole('checkbox', { name: 'The information provided is' }).check(); 

  await page.getByRole('textbox', { name: 'Evidence notes (optional)' }).fill(`AUTO Test evidence optional notes ${unique_id}`);
  
  // pause and wait for manual inspection of the form fields
  await page.pause(); // Execution stops here

  if (commit) {
  
    await page.getByRole('button', { name: 'Submit to CER' }).click();
    // wait for the next page to load before signing out
    await page.waitForLoadState('networkidle');

    const screenshot = await page.screenshot();

    await testInfo.attach('Application Screenshot', {
        body: screenshot,
        contentType: 'image/png',
    });

    await page.pause(); // Execution stops here, record assertion that new record is pending approval
    
  }




  //switch back to admin role and sign out
  await page.locator('button.identity-switcher__trigger.topbar__user').hover();
  await page.getByLabel('RoleCER adminCER').selectOption('cer_admin');
  await page.getByRole('button', { name: 'Switch' }).click();

  // wait for the next page to load before signing out
  await page.waitForLoadState('networkidle');

  //hover over signout button 

  await page.getByRole('button', { name: 'Sign out' }).hover()
  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByRole('button', { name: 'Sign out' })).not.toBeVisible();

  const current_url = page.url();

  await test.step ('Capture page URL', async () => {
    console.log(`Logged in URL: ${current_url}`);
    expect(current_url).toMatch(login_url);
  }); 

  await page.goto("about:blank");

  await page.goto(login_url);
  await page.getByLabel(/email|username/i).fill(username);
  await page.getByLabel(/password/i).fill("wrongpassword");
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();

  */
});