import { onBeforeUnmount, ref } from "vue";

export function useIsMobile(breakpoint = 768) {
  const query = window.matchMedia(`(max-width: ${breakpoint}px)`);
  const isMobile = ref(query.matches);

  function onChange(e: MediaQueryListEvent) {
    isMobile.value = e.matches;
  }

  query.addEventListener("change", onChange);
  onBeforeUnmount(() => query.removeEventListener("change", onChange));

  return { isMobile };
}
