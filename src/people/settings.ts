import { localSetting, localTimeSetting } from './localSetting'
import { DEFAULT_DATE_MINUTES, DEFAULT_DIGEST_MINUTES } from './reminders'

// "Show reciprocity" (docs: the reciprocity spec): off hides every direction
// arrow, reason line and balance. Direction is still recorded and still
// shapes the Reach out order either way.
export const SHOW_RECIPROCITY_KEY = 'lg-people-show-reciprocity'
const setting = localSetting(SHOW_RECIPROCITY_KEY, true)

export const isReciprocityShown = setting.get
export const setReciprocityShown = setting.set
export const useShowReciprocity = setting.use

// Phone contacts (docs: the People spec): off by default. While off, no
// import or link entry point shows and the permission is never requested.
export const CONTACTS_ENABLED_KEY = 'lg-people-contacts'
const contacts = localSetting(CONTACTS_ENABLED_KEY, false)

export const setContactsEnabled = contacts.set
export const useContactsEnabled = contacts.use

// Birthday and date notifications (docs: the People spec, Reminders): on by
// default on the phone apps. Per device, like the system permission it rides
// on. The overdue digest is per person instead (notify_when_overdue).
export const DATE_REMINDERS_KEY = 'lg-people-date-reminders'
const dateReminders = localSetting(DATE_REMINDERS_KEY, true)

export const isDateRemindersOn = dateReminders.get
export const setDateRemindersOn = dateReminders.set
export const useDateRemindersOn = dateReminders.use

// When those notifications go out, in minutes after midnight, per device.
export const DATE_REMINDER_TIME_KEY = 'lg-people-date-reminder-time'
export const DIGEST_TIME_KEY = 'lg-people-digest-time'
const dateTime = localTimeSetting(DATE_REMINDER_TIME_KEY, DEFAULT_DATE_MINUTES)
const digestTime = localTimeSetting(DIGEST_TIME_KEY, DEFAULT_DIGEST_MINUTES)

export const getDateReminderMinutes = dateTime.get
export const setDateReminderMinutes = dateTime.set
export const useDateReminderMinutes = dateTime.use
export const getDigestMinutes = digestTime.get
export const setDigestMinutes = digestTime.set
export const useDigestMinutes = digestTime.use

// Today's birthdays and dates to dayGLANCE (docs: the People spec, Intents):
// off by default, and per device so two phones don't both send them.
export const DATES_TO_DAYGLANCE_KEY = 'lg-people-dates-dayglance'
const datesToDayglance = localSetting(DATES_TO_DAYGLANCE_KEY, false)

export const isDatesToDayglanceOn = datesToDayglance.get
export const setDatesToDayglanceOn = datesToDayglance.set
export const useDatesToDayglanceOn = datesToDayglance.use
