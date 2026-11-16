import { Page, expect} from '@playwright/test';
import { getCredentials, UserRole } from './credentials';
import { debug } from './test-helper';

export async function loginAs(
  page: Page,
  role: UserRole
) {
  // Add the login recording to its own page object
  const base_url = process.env.BASE_URL;
  debug('Base URL', base_url); 

  if (!base_url) {
    throw new Error('Check BASE_URL and update if required before running this test.');
  }

  // Use the destination URL rather than the Outlook Safe Links wrapper.
  await page.goto(base_url, {waitUntil:'load'});
  const credentials = await getCredentials(role);
  // use utils/credentials.ts 

  debug('Role', credentials.mapping );
  debug('User', credentials.username );
  debug('Secret', credentials.password );

  await page.getByLabel(/email|username/i).fill(credentials.username);
  await page.getByLabel(/password/i).fill(credentials.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  
  // Switcher is a sub comoponent of the topbar, maybe add a hover to the topbar to ensure the switcher is visible
  // add hover here to ensure selector for role switch is visible, use locator to find the button by class name
  await page.locator('button.identity-switcher__trigger.topbar__user').hover();

  // select role option
  await page.getByLabel('RoleCER adminCER').selectOption(credentials.mapping);

/*
  await page.getByLabel('RoleCER adminCER').selectOption('cer_officer');
  await page.getByLabel('RoleCER adminCER').selectOption('participant_admin');
  await page.getByLabel('RoleCER adminCER').selectOption('participant_user');
  await page.getByLabel('RoleCER adminCER').selectOption('applicant');
  await page.getByLabel('RoleCER adminCER').selectOption('cer_admin');
*/

  await page.pause();

  
  // switch role
  await page.getByRole('button', { name: 'Switch' }).click();

  await expect(page.getByRole('banner')).toContainText('RegiGov');
  
  await page.pause();

}