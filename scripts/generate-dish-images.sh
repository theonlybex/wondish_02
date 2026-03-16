#!/bin/bash
# Usage: GEMINI_API_KEY=your-key bash scripts/generate-dish-images.sh

if [ -z "$GEMINI_API_KEY" ]; then
  echo "Error: set GEMINI_API_KEY first"
  exit 1
fi

SKILL="/c/Users/abdim/.claude/plugins/cache/buildatscale-claude-code/nano-banana/78cf7e42f5d8/skills/generate/scripts/image.py"
OUT="$(pwd)/public/dishes"
OPTS="--model 2 --aspect 4:3 --size 1K"

mkdir -p "$OUT"

uv run "$SKILL" --prompt "Professional food photography studio shot of avocado toast with two perfectly poached eggs on sourdough bread, red pepper flakes, olive oil drizzle, white ceramic plate, clean white marble surface, soft natural light, overhead angle, restaurant quality" --output "$OUT/dish-1.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of Greek yogurt parfait in a tall glass with fresh berries, granola layers, honey drizzle, white background, soft natural light, overhead view, restaurant quality" --output "$OUT/dish-2.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of overnight oats with fresh blueberries and raspberries, chia seeds, cinnamon sprinkle, in a ceramic bowl, white marble surface, soft natural light, overhead flat lay, restaurant quality" --output "$OUT/dish-3.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of spinach and feta omelette folded on a white plate, wilted spinach, cherry tomatoes, crumbled feta, white marble background, soft natural light, overhead angle, restaurant quality" --output "$OUT/dish-4.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of fluffy banana protein pancakes stacked with maple syrup drizzle, sliced banana on top, white plate, clean marble background, soft natural light, slight angle, restaurant quality" --output "$OUT/dish-5.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of grilled chicken Caesar salad with crisp romaine lettuce, parmesan shavings, croutons, grilled chicken breast slices, white ceramic bowl, marble surface, soft natural light, overhead angle, restaurant quality" --output "$OUT/dish-6.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of Mediterranean quinoa bowl with cucumber, tomato, kalamata olives, roasted red pepper, fresh herbs, white bowl, marble surface, soft natural light, overhead flat lay, restaurant quality" --output "$OUT/dish-7.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of turkey and avocado wrap cut in half on a white plate, roasted turkey, fresh avocado slices, mixed greens visible, white marble background, soft natural light, slight angle, restaurant quality" --output "$OUT/dish-8.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of red lentil soup in a white ceramic bowl, golden turmeric color, drizzle of olive oil, fresh herbs garnish, slice of whole grain bread on the side, marble surface, soft natural light, overhead angle, restaurant quality" --output "$OUT/dish-9.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of tuna Nicoise salad with albacore tuna, green beans, cherry tomatoes, hard-boiled egg halves, black olives, white plate, marble surface, soft natural light, overhead flat lay, restaurant quality" --output "$OUT/dish-10.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of herb-baked salmon fillet with fresh dill, lemon slices, roasted asparagus and sweet potato, white plate, marble surface, soft natural light, slight overhead angle, restaurant quality" --output "$OUT/dish-11.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of chicken and vegetable stir fry with colorful bell peppers, broccoli, snap peas, carrots over brown rice, white bowl, marble surface, soft natural light, overhead angle, restaurant quality" --output "$OUT/dish-12.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of pasta primavera with whole wheat pasta, seasonal vegetables, fresh basil, garlic, olive oil, white ceramic plate, marble surface, soft natural light, slight angle, restaurant quality" --output "$OUT/dish-13.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of lean beef tenderloin medallions with steamed broccoli, roasted garlic sweet potato mash, herb jus, elegant white plate, marble surface, soft natural light, fine dining restaurant quality" --output "$OUT/dish-14.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of black bean tacos in soft corn tortillas, fresh pico de gallo, shredded cabbage, lime crema, lime wedges, white plate, marble surface, soft natural light, overhead angle, restaurant quality" --output "$OUT/dish-15.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of mixed nuts and dried fruit in a small white ceramic bowl, almonds walnuts cashews dried cranberries, marble surface, soft natural light, overhead angle, clean minimal food photography" --output "$OUT/dish-16.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of hummus with fresh vegetable sticks, creamy hummus in a white bowl with olive oil drizzle, cucumber spears, carrot sticks, celery, cherry tomatoes, marble surface, soft natural light, overhead angle, restaurant quality" --output "$OUT/dish-17.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of green protein smoothie in a tall glass, banana slices on rim, spinach visible, straw, marble surface, soft natural light, clean minimal food photography" --output "$OUT/dish-18.png" $OPTS &
uv run "$SKILL" --prompt "Professional food photography studio shot of sliced apple with almond butter, crisp apple slices arranged around a small white bowl of smooth almond butter, marble surface, soft natural light, overhead flat lay, clean minimal food photography" --output "$OUT/dish-19.png" $OPTS &

wait
echo "✓ All 19 dish images generated in public/dishes/"
