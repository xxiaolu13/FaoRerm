import { useToastStore } from "../stores/toastStore";
import type { ToastVariant } from "../stores/toastStore";

const variantIcons: Record<ToastVariant, string> = {
  default: "",
  success: "M5 13L9 17L19 7",
  error: "M6 6L18 18M18 6L6 18",
  warning: "M12 2L22 20H2L12 2Z",
};

const variantClass: Record<ToastVariant, string> = {
  default: "toast--default",
  success: "toast--success",
  error: "toast--error",
  warning: "toast--warning",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${variantClass[t.variant]}`}>
          {t.variant !== "default" && (
            <span className="toast-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d={variantIcons[t.variant]}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )}
          <div className="toast-content">
            <span className="toast-title">{t.title}</span>
            {t.description && (
              <span className="toast-desc">{t.description}</span>
            )}
          </div>
          <button
            className="toast-close"
            onClick={() => removeToast(t.id)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M4 4L10 10M10 4L4 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
