/**
 * Copy text to clipboard
 *  @param textToCopy
 *  @returns Promise<boolean>
 */
export const copyTextToClipboard = (textToCopy: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    // Navigator clipboard api needs a secure context (https)
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(textToCopy)
        .then(() => resolve(true))
        .catch(() => reject(false))
    } else {
      // Use the 'out of viewport hidden text area' trick
      const textArea = document.createElement('textarea')
      textArea.value = textToCopy

      // Move textarea out of the viewport so it's not visible
      textArea.style.position = 'absolute'
      textArea.style.display = 'none'
      textArea.style.left = '-999999px'

      document.body.prepend(textArea)
      textArea.select()

      try {
        document.execCommand('copy')
        resolve(true)
      } catch (error) {
        reject(false)
      } finally {
        textArea.remove()
      }
    }
  })
