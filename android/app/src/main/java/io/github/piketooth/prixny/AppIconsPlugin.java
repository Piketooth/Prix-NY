package io.github.piketooth.prixny;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.util.List;
import org.json.JSONException;

/**
 * Icônes officielles des applis installées et liste des applis du téléphone,
 * pour la page « Applis utiles ».
 */
@CapacitorPlugin(name = "AppIcons")
public class AppIconsPlugin extends Plugin {

    private static final int SIZE = 96;

    /** Icône d'une appli en PNG (data URL), ou null si elle n'est pas installée. */
    private String iconOf(PackageManager pm, String pkg) {
        try {
            return toDataUrl(pm.getApplicationIcon(pkg));
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    private String toDataUrl(Drawable d) {
        Bitmap bmp = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        d.setBounds(0, 0, SIZE, SIZE);
        d.draw(canvas);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
        bmp.recycle();
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    /** { packages: [...] } → { icons: { paquet: dataUrl } } pour les applis installées. */
    @PluginMethod
    public void icons(PluginCall call) {
        JSArray packages = call.getArray("packages");
        if (packages == null) {
            call.reject("packages manquant");
            return;
        }
        new Thread(() -> {
            PackageManager pm = getContext().getPackageManager();
            JSObject icons = new JSObject();
            try {
                for (String pkg : packages.<String>toList()) {
                    String icon = iconOf(pm, pkg);
                    if (icon != null) icons.put(pkg, icon);
                }
            } catch (JSONException e) {
                call.reject("packages invalide");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("icons", icons);
            call.resolve(ret);
        }).start();
    }

    /** Applis lançables du téléphone : { apps: [{ pkg, name, icon }] }, triées par nom. */
    @PluginMethod
    public void installed(PluginCall call) {
        new Thread(() -> {
            PackageManager pm = getContext().getPackageManager();
            Intent launcher = new Intent(Intent.ACTION_MAIN);
            launcher.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> list = pm.queryIntentActivities(launcher, 0);
            list.sort((a, b) -> a.loadLabel(pm).toString().compareToIgnoreCase(b.loadLabel(pm).toString()));
            JSArray apps = new JSArray();
            String self = getContext().getPackageName();
            java.util.HashSet<String> seen = new java.util.HashSet<>();
            for (ResolveInfo ri : list) {
                String pkg = ri.activityInfo.packageName;
                if (pkg.equals(self) || !seen.add(pkg)) continue;
                JSObject app = new JSObject();
                app.put("pkg", pkg);
                app.put("name", ri.loadLabel(pm).toString());
                app.put("icon", toDataUrl(ri.loadIcon(pm)));
                apps.put(app);
            }
            JSObject ret = new JSObject();
            ret.put("apps", apps);
            call.resolve(ret);
        }).start();
    }
}
