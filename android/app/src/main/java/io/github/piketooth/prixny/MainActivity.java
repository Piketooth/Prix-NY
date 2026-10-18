package io.github.piketooth.prixny;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppIconsPlugin.class); // plugin de l'appli (icônes et liste des applis)
        super.onCreate(savedInstanceState);
    }
}
