package app.cadence.planner;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Switch;
import android.widget.TextView;

/** Picks which Today panels a widget shows. Opens when the widget is added, and from its gear. */
public class WidgetConfigActivity extends Activity {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        int widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        Intent result = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_CANCELED, result); // backing out of a new widget doesn't add it
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        setTitle("Widget panels");

        int pad = dp(20);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, dp(8), pad, dp(12));

        TextView hint = new TextView(this);
        hint.setText("Choose what this widget shows from your Today page.");
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        hint.setPadding(0, 0, 0, dp(8));
        root.addView(hint);

        Switch[] toggles = new Switch[CadenceWidget.PANELS.length];
        for (int i = 0; i < toggles.length; i++) {
            Switch toggle = new Switch(this);
            toggle.setText(CadenceWidget.PANEL_LABELS[i]);
            toggle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            toggle.setChecked(CadenceWidget.shows(this, widgetId, CadenceWidget.PANELS[i]));
            toggle.setMinHeight(dp(48));
            toggles[i] = toggle;
            root.addView(toggle, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }

        Button done = new Button(this);
        done.setText("Done");
        done.setOnClickListener((view) -> {
            for (int i = 0; i < toggles.length; i++) {
                CadenceWidget.setShows(this, widgetId, CadenceWidget.PANELS[i], toggles[i].isChecked());
            }
            CadenceWidget.refreshAll(this);
            setResult(RESULT_OK, result);
            finish();
        });
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        buttonParams.gravity = Gravity.END;
        buttonParams.topMargin = dp(8);
        root.addView(done, buttonParams);
        setContentView(root);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
