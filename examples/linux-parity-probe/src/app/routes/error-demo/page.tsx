/** file-routing probe: throws during render to exercise the sibling error.tsx boundary. */
export default function ErrorDemoPage() {
  throw new Error('linux-parity-probe: intentional render error for the error-boundary probe')
}
