import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import QuestionBubble from "./QuestionBubble.vue";

describe("QuestionBubble", () => {
  it("renders the question text", () => {
    const wrapper = mount(QuestionBubble, { props: { question: "What size burrito?" } });
    expect(wrapper.text()).toContain("What size burrito?");
  });

  it("has the question test marker", () => {
    const wrapper = mount(QuestionBubble, { props: { question: "x" } });
    expect(wrapper.find('[data-test="chat-question"]').exists()).toBe(true);
  });
});
