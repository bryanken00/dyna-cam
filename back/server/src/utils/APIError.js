// Custom error class to extend the built-in Error class with additional properties
class ExtendableError extends Error {
  constructor(message, status, isPublic) {
    // Calling the parent class (Error) constructor with the error message
      super(message)
    // Setting the name of the error to the class name (ExtendableError)
      this.name = this.constructor.name
    // Assigning the error message
      this.message = message
    // Assigning the HTTP status code for the error (e.g., 400, 500)
      this.status = status
    // Flag to indicate whether the error message should be publicly visible
      this.isPublic = isPublic
    // Flag to indicate if the error is operational (i.e., expected errors)
      this.isOperational = true // This is required since bluebird 4 doesn't append it anymore.
      if (typeof Error.captureStackTrace === 'function') {
          Error.captureStackTrace(this, this.constructor);
      } else {
          this.stack = (new Error(message)).stack;
      }
  }
}

// APIError class that extends ExtendableError, specifically for API-related errors
class APIError extends ExtendableError {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', isPublic = process.env.NODE_ENV !== 'production') {
    // Calling the parent class (ExtendableError) constructor
    // Sets the default status to 500 (Internal Server Error) if not provided
    // isPublic defaults to false in production, true in other environments (e.g., development)
      super(message, status, isPublic)
      this.code = code // Machine-readable error code for frontend
  }
}

/**
 * Standard error codes for API responses
 * Use these constants for consistency across the application
 */
export const ERROR_CODES = {
  // Authentication (401)
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',

  // Authorization (403)
  FORBIDDEN: 'FORBIDDEN',
  CSRF_INVALID: 'CSRF_INVALID',
  CSRF_PROTECTION_ERROR: 'CSRF_PROTECTION_ERROR',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',

  // Locked (423)
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',

  // Not Found (404)
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',

  // Validation (400)
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_STATUS: 'INVALID_STATUS',

  // Conflict (409)
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  USERNAME_TAKEN: 'USERNAME_TAKEN',

  // Rate Limiting (429)
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // Unavailable (503)
  CAMERA_OFFLINE: 'CAMERA_OFFLINE',
  // PLAN-003: a closure would land on live bookings — error.conflicts lists them
  BOOKINGS_IN_THE_WAY: 'BOOKINGS_IN_THE_WAY',
  // PLAN-002 Phase I: the API has no RECORDER_ENROLL_KEY, so boxes can't enrol
  ENROLLMENT_DISABLED: 'ENROLLMENT_DISABLED',
  // CR-040: Google Drive didn't answer the API for a box's upload — the box tries again
  DRIVE_UNAVAILABLE: 'DRIVE_UNAVAILABLE',
  // CR-040: an old recorder box tried the removed upload to the API
  BOX_UPDATE_REQUIRED: 'BOX_UPDATE_REQUIRED',

  // Server Errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
};

export default APIError
